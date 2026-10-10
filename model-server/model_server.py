import os
import sys
import hmac
import logging
import threading
from flask import Flask, request, jsonify

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.embedding import EmbeddingModel
from models.llm import LLMModel
from rag.retriever import Retriever
from rag.generator import Generator
from rag.indexer import PDFIndexer
from rag.utils import get_data_dir
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
retriever = None
generator = None

# Guards against concurrent indexing runs. NOTE: this lock is process-local,
# which is why the gunicorn worker count MUST stay at 1 (see Dockerfile).
indexing_lock = threading.Lock()

# Input limits for /query
MAX_QUERY_LENGTH = 2000
MIN_TOP_K = 1
MAX_TOP_K = 20
MAX_CHAT_HISTORY_ENTRIES = 20


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


def initialize_models():
    """Initialize and load all models at startup"""
    global embedding_model, llm_model, retriever, generator

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

    # Initialize retriever and generator
    retriever = Retriever("egyptian_history", "monument_data")  # Pass both arguments
    retriever.embedding_model = embedding_model  # Share the already loaded model

    generator = Generator("egyptian_history")
    generator.llm = llm_model  # Share the already loaded model
    generator.retriever = retriever  # Share the already loaded retriever

    logger.info("All models initialized successfully!")

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "models_loaded": {
            "embedding_model": embedding_model is not None and embedding_model.model_loaded,
            "llm_model": llm_model is not None and llm_model.model_loaded,
            "retriever": retriever is not None,
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
        # Cap history length — the window selection downstream only needs
        # the most recent entries anyway
        chat_history = chat_history[-MAX_CHAT_HISTORY_ENTRIES:]

        # Generate response with chat history
        response = generator.generate_response(query_text, top_k=top_k, chat_history=chat_history)

        return jsonify({
            "success": True,
            "query": query_text,
            "response": response
        })
    except Exception:
        logger.exception("Error processing query")
        return jsonify({"error": "query failed"}), 500

@app.route('/index', methods=['POST'])
def index_document():
    """Index a PDF that lives in the data/ directory.

    This replaces the old flow where the Express backend spawned
    rag/indexer.py as a local child process — running indexing in-process
    here means the backend only ever talks to this server over HTTP.

    Request body: {"filename": "egyptian_history.pdf"}
    Blocks until indexing completes and returns success/failure.
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
        return jsonify({"error": "indexing already in progress"}), 409

    try:
        logger.info(f"Indexing {pdf_path}")
        indexer = PDFIndexer(pdf_path)

        # Reuse the already-loaded embedding model instead of loading a second copy
        if embedding_model is not None and embedding_model.model_loaded:
            indexer.embedding_model = embedding_model

        success = indexer.index()

        # Invalidate the retriever's cached vectors INSIDE the lock so the
        # next query picks up the freshly indexed document and no query can
        # observe the new files with stale in-memory data in between.
        if success and retriever is not None:
            retriever.embeddings = None
            retriever.metadata = None
    except Exception:
        logger.exception("Error indexing document")
        return jsonify({"error": "indexing failed"}), 500
    finally:
        indexing_lock.release()

    if not success:
        return jsonify({"error": "indexing failed"}), 500

    logger.info(f"Indexing completed for {filename}")
    return jsonify({
        "success": True,
        "message": f"Indexing of {filename} completed successfully",
        "progress": 100
    })

# Initialize models at import time so this also runs under gunicorn — each
# worker imports this module once, and the worker count is pinned to 1 in
# the Dockerfile because indexing_lock is process-local.
initialize_models()

if __name__ == "__main__":
    # Local development only — production runs under gunicorn (see Dockerfile).
    # Bind to localhost by default — only the Express backend needs to reach
    # this server. In Docker, HOST=0.0.0.0 is set so other containers can connect.
    port = int(os.environ.get("PORT", 5050))
    host = os.environ.get("HOST", "127.0.0.1")
    logger.info(f"Model server running on {host}:{port}")
    app.run(host=host, port=port, debug=False)
