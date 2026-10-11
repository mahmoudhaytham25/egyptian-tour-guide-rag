import os
import hmac
import time
import uuid
import logging
import threading
from flask import Flask, request, jsonify

from models.embedding import EmbeddingModel
from models.llm import LLMModel
from rag.retriever import Retriever
from rag.generator import Generator, DeadlineExceeded
from rag.indexer import PDFIndexer
from rag.utils import get_data_dir, get_vector_store_dir
from rag.utils.env_loader import load_environment, get_api_key

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables
load_environment()

# Internal auth token — REQUIRED. The Express backend sends this shared
# secret in the X-Internal-Token header. This service must never run
# unauthenticated (it is published on a host port), so fail fast at
# startup — including under gunicorn, which imports this module — if the
# token is not configured.
INTERNAL_API_TOKEN = os.environ.get("INTERNAL_API_TOKEN")
if not INTERNAL_API_TOKEN:
    raise RuntimeError(
        "INTERNAL_API_TOKEN is not set — refusing to start. "
        "Set it in the environment or in the .env file."
    )

app = Flask(__name__)

# Global models - loaded once at startup
embedding_model = None
llm_model = None
generator = None

# Per-document retrievers, constructed lazily on first use and cached.
# Indexing a document evicts ONLY that document's retriever — other
# documents keep their warm caches.
DEFAULT_DOCUMENT = "egyptian_history"
TIMES_NAME = "monument_data"
retrievers = {}
retrievers_lock = threading.Lock()

# Guards against concurrent indexing runs. NOTE: this lock is process-local,
# which is why the gunicorn worker count MUST stay at 1 (see Dockerfile).
# The request handler acquires it non-blocking and the background worker
# thread releases it when the job finishes.
indexing_lock = threading.Lock()

# State of the single global indexing job, reported by GET /index/status.
# Guarded by its own lock — indexing_lock stays held for the entire job,
# so using it here would make /index/status block until indexing finishes.
_index_job_lock = threading.Lock()
_index_job = {"status": "idle"}

# Input limits for /query
MAX_QUERY_LENGTH = 2000
MIN_TOP_K = 1
MAX_TOP_K = 20
MAX_CHAT_HISTORY_ENTRIES = 20
# Cap on the caller-supplied per-query time budget — stays comfortably
# under gunicorn's 600s worker timeout so a budget can never outlive the
# worker itself.
MAX_TIMEOUT_MS = 540000


@app.before_request
def require_internal_token():
    """Require the shared-secret X-Internal-Token header on every route.

    /health is exempt so Docker/orchestrator healthchecks work without
    holding the secret. Uses a constant-time comparison to avoid timing
    side channels.
    """
    if request.path == "/health":
        return None
    token = request.headers.get("X-Internal-Token", "")
    if not hmac.compare_digest(token.encode("utf-8"), INTERNAL_API_TOKEN.encode("utf-8")):
        return jsonify({"error": "unauthorized"}), 401
    return None


def get_retriever(document):
    """Return the retriever for a document, constructing it on first use."""
    with retrievers_lock:
        retriever = retrievers.get(document)
        if retriever is None:
            retriever = Retriever(document, TIMES_NAME)
            retriever.embedding_model = embedding_model  # Share the already loaded model
            retrievers[document] = retriever
        return retriever


def invalidate_retriever(document):
    """Drop a document's cached retriever so the next query reloads its
    freshly indexed vectors. Other documents' caches are untouched."""
    with retrievers_lock:
        retrievers.pop(document, None)


def _document_is_indexed(document):
    """True when the document's vector store exists on disk."""
    vector_store_dir = get_vector_store_dir()
    return (
        os.path.exists(os.path.join(vector_store_dir, f"{document}_vectors.npz"))
        and os.path.exists(os.path.join(vector_store_dir, f"{document}_metadata.json"))
    )


def _update_index_job(**fields):
    with _index_job_lock:
        _index_job.update(fields)


def _run_indexing_job(safe_filename, pdf_path):
    """Background worker for POST /index.

    indexing_lock was acquired (non-blocking) by the request handler; this
    function releases it when the job finishes, success or failure.
    """
    try:
        logger.info(f"Indexing {pdf_path}")
        indexer = PDFIndexer(pdf_path)

        # Reuse the already-loaded embedding model instead of loading a second copy
        if embedding_model is not None and embedding_model.model_loaded:
            indexer.embedding_model = embedding_model

        success = indexer.index()

        if success:
            # Evict this document's retriever BEFORE releasing the lock so
            # the next query picks up the freshly indexed vectors and no
            # query can observe the new files with stale in-memory data in
            # between. Other documents' retrievers are untouched.
            invalidate_retriever(os.path.splitext(safe_filename)[0])
            _update_index_job(status="done")
            logger.info(f"Indexing completed for {safe_filename}")
        else:
            _update_index_job(status="error", error="indexing failed")
    except Exception:
        logger.exception("Error indexing document")
        _update_index_job(status="error", error="indexing failed")
    finally:
        indexing_lock.release()


def initialize_models():
    """Initialize and load all models at startup"""
    global embedding_model, llm_model, generator

    logger.info("Initializing models...")

    # Get API key using our secure method. Both the LLM and the embedding
    # model use the remote Gemini API, so this key is required for indexing
    # AND querying — nothing is downloaded locally. prompt_if_missing=False
    # because an interactive prompt could hang a process supervisor; a
    # missing key is a logged warning instead (calls will fail cleanly).
    api_key = get_api_key("GEMINI_API_KEY", prompt_if_missing=False)
    if not api_key:
        logger.warning("No Gemini API key provided. Indexing, retrieval, and generation will not work.")
    else:
        logger.info("Gemini API key found")

    # Initialize embedding model (configures the Gemini embeddings API —
    # no local model download, so this is fast)
    embedding_model = EmbeddingModel()
    embedding_model.load_model()

    # Initialize LLM model
    llm_model = LLMModel()
    llm_model.load_model()

    # Initialize the generator and share the already loaded LLM plus the
    # lazily-cached default retriever
    generator = Generator(DEFAULT_DOCUMENT)
    generator.llm = llm_model  # Share the already loaded model
    generator.retriever = get_retriever(DEFAULT_DOCUMENT)

    logger.info("All models initialized successfully!")

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "models_loaded": {
            "embedding_model": embedding_model is not None and embedding_model.model_loaded,
            "llm_model": llm_model is not None and llm_model.model_loaded,
            "retriever": retrievers is not None,
            "generator": generator is not None
        }
    })

@app.route('/query', methods=['POST'])
def query():
    """Query the RAG system"""
    try:
        # silent=True so malformed JSON gets the same 400 {"error": ...}
        # shape as other validation failures instead of an HTML 400 page
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"error": "JSON body is required"}), 400

        query_text = data.get('query')
        if not isinstance(query_text, str) or not query_text.strip():
            return jsonify({"error": "query must be a non-empty string"}), 400
        if len(query_text) > MAX_QUERY_LENGTH:
            return jsonify({"error": f"query must be at most {MAX_QUERY_LENGTH} characters"}), 400

        top_k = data.get('top_k', 10)
        if (isinstance(top_k, bool) or not isinstance(top_k, int)
                or not MIN_TOP_K <= top_k <= MAX_TOP_K):
            return jsonify({"error": f"top_k must be an integer between {MIN_TOP_K} and {MAX_TOP_K}"}), 400

        chat_history = data.get('chat_history', [])
        if not isinstance(chat_history, list):
            return jsonify({"error": "chat_history must be a list"}), 400
        # Drop malformed entries instead of failing the request — downstream
        # formatting assumes dicts with string role/content and would die on
        # a KeyError otherwise.
        chat_history = [
            msg for msg in chat_history
            if isinstance(msg, dict)
            and isinstance(msg.get('role'), str)
            and isinstance(msg.get('content'), str)
        ]
        # Cap history length — the window selection downstream only needs
        # the most recent entries anyway
        chat_history = chat_history[-MAX_CHAT_HISTORY_ENTRIES:]

        # Which indexed document to query — a bare name (no extension, no
        # path), sanitized identically to /index filenames
        document = data.get('document') or DEFAULT_DOCUMENT
        if not isinstance(document, str):
            return jsonify({"error": "document must be a string"}), 400
        safe_document = os.path.basename(document)
        if safe_document != document or not safe_document:
            return jsonify({"error": "invalid document — only names of indexed PDFs are allowed"}), 400

        if not _document_is_indexed(safe_document):
            return jsonify({
                "success": False,
                "error": f"unknown document '{safe_document}' — it has not been indexed"
            }), 404

        # Cooperative cancellation: the backend may send its own remaining
        # budget (timeout_ms) so this server stops issuing Gemini calls
        # once an answer can't reach the client inside it anyway. Capped
        # below gunicorn's 600s worker timeout.
        deadline = None
        timeout_ms = data.get('timeout_ms')
        if timeout_ms is not None:
            if (isinstance(timeout_ms, bool) or not isinstance(timeout_ms, int)
                    or not 0 < timeout_ms <= MAX_TIMEOUT_MS):
                return jsonify({
                    "error": f"timeout_ms must be an integer between 1 and {MAX_TIMEOUT_MS}"
                }), 400
            deadline = time.monotonic() + timeout_ms / 1000.0

        # Generate response with chat history against that document's
        # retriever
        response = generator.generate_response(
            query_text,
            top_k=top_k,
            chat_history=chat_history,
            retriever=get_retriever(safe_document),
            deadline=deadline,
        )

        return jsonify({
            "success": True,
            "query": query_text,
            "response": response
        })
    except DeadlineExceeded as e:
        # Budget blown between pipeline stages — a clean 504 (not a hang)
        # lets the backend tell this apart from an upstream timeout.
        logger.warning("Query aborted by caller time budget: %s", e)
        return jsonify({"success": False, "error": str(e)}), 504
    except Exception:
        # success:false + 5xx tells the backend NOT to persist an assistant
        # message — generation genuinely failed rather than producing a
        # user-facing answer.
        logger.exception("Error processing query")
        return jsonify({"success": False, "error": "query failed"}), 500

@app.route('/index', methods=['POST'])
def index_document():
    """Queue indexing of a PDF that lives in the data/ directory.

    This replaces the old flow where the Express backend spawned
    rag/indexer.py as a local child process — running indexing in-process
    here means the backend only ever talks to this server over HTTP.

    Request body: {"filename": "egyptian_history.pdf"}
    Returns 202 immediately; poll GET /index/status for the outcome.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON body is required"}), 400

    filename = data.get('filename')
    if not filename or not isinstance(filename, str):
        return jsonify({"error": "filename is required"}), 400

    # Sanitize: bare filenames only, must be a PDF (mirrors backend validation)
    safe_filename = os.path.basename(filename)
    if safe_filename != filename or not safe_filename.lower().endswith('.pdf'):
        return jsonify({"error": "invalid filename — only PDF files in the data directory are allowed"}), 400

    pdf_path = os.path.join(get_data_dir(), safe_filename)
    if not os.path.exists(pdf_path):
        return jsonify({"error": "PDF file not found in data directory"}), 404

    if not indexing_lock.acquire(blocking=False):
        with _index_job_lock:
            job = dict(_index_job)
        return jsonify({
            "error": "indexing already in progress",
            "job_id": job.get("job_id"),
            "filename": job.get("filename"),
        }), 409

    job_id = uuid.uuid4().hex
    _update_index_job(status="indexing", job_id=job_id, filename=safe_filename, error=None)

    try:
        threading.Thread(
            target=_run_indexing_job,
            args=(safe_filename, pdf_path),
            daemon=True,
        ).start()
    except Exception:
        # The worker never ran, so nothing else will release
        # indexing_lock — hand it back here or every later POST /index
        # wedges at 409.
        logger.exception(f"Failed to start indexing thread for {safe_filename}")
        indexing_lock.release()
        _update_index_job(status="error", error="failed to start indexing job")
        return jsonify({"error": "failed to start indexing job"}), 500

    logger.info(f"Indexing started for {filename} (job {job_id})")
    return jsonify({
        "job_id": job_id,
        "filename": safe_filename,
        "status": "indexing"
    }), 202

@app.route('/index/status', methods=['GET'])
def index_status():
    """Report the state of the single global indexing job.

    Response: {"status": "idle"|"indexing"|"done"|"error"} plus job_id,
    filename, and error when present.
    """
    with _index_job_lock:
        job = {key: value for key, value in _index_job.items() if value is not None}
    return jsonify(job)

# Initialize models at import time so this also runs under gunicorn — each
# worker imports this module once, and the worker count is pinned to 1 in
# the Dockerfile because indexing_lock is process-local.
initialize_models()

if __name__ == "__main__":
    # Local development only — production runs under gunicorn, which binds
    # 0.0.0.0:5050 directly (see Dockerfile CMD — HOST/PORT are not read
    # there). Bind to localhost by default here — only the Express backend
    # needs to reach this server.
    port = int(os.environ.get("PORT", 5050))
    host = os.environ.get("HOST", "127.0.0.1")
    logger.info(f"Model server running on {host}:{port}")
    app.run(host=host, port=port, debug=False)
