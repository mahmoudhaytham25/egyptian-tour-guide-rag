import os
import sys
import json
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

app = Flask(__name__)

# Global models - loaded once at startup
embedding_model = None
llm_model = None
retriever = None
generator = None

# Guards against concurrent indexing runs
indexing_lock = threading.Lock()

def initialize_models():
    """Initialize and load all models at startup"""
    global embedding_model, llm_model, retriever, generator
    
    logger.info("Initializing models - this may take a minute...")
    
    # Get API key using our secure method.
    # Only prompt interactively when attached to a TTY — inside a container
    # (or any non-interactive environment) input() would raise EOFError and
    # crash startup, so we skip prompting there and just warn.
    api_key = get_api_key("GEMINI_API_KEY", prompt_if_missing=sys.stdin.isatty())
    if not api_key:
        logger.warning("No Gemini API key provided. Some features may not work.")
    else:
        logger.info("Gemini API key found")
    
    # Initialize embedding model
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
        data = request.json
        if not data or 'query' not in data:
            return jsonify({
                "success": False,
                "message": "Query is required"
            }), 400
        
        query_text = data['query']
        top_k = data.get('top_k', 10)
        chat_history = data.get('chat_history', [])
        
        # Generate response with chat history
        response = generator.generate_response(query_text, top_k=top_k, chat_history=chat_history)
        
        return jsonify({
            "success": True,
            "query": query_text,
            "response": response
        })
    except Exception as e:
        logger.error(f"Error processing query: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Error processing query",
            "error": str(e)
        }), 500

@app.route('/index', methods=['POST'])
def index_document():
    """Index a PDF that lives in the data/ directory.

    This replaces the old flow where the Express backend spawned
    rag/indexer.py as a local child process — running indexing in-process
    here means the backend only ever talks to this server over HTTP.

    Request body: {"filename": "egyptian_history.pdf"}
    Blocks until indexing completes and returns success/failure.
    """
    data = request.get_json(silent=True) or {}
    filename = data.get('filename')

    if not filename or not isinstance(filename, str):
        return jsonify({
            "success": False,
            "message": "Filename is required"
        }), 400

    # Sanitize: bare filenames only, must be a PDF (mirrors backend validation)
    safe_filename = os.path.basename(filename)
    if safe_filename != filename or not safe_filename.lower().endswith('.pdf'):
        return jsonify({
            "success": False,
            "message": "Invalid filename. Only PDF files in the data directory are allowed."
        }), 400

    pdf_path = os.path.join(get_data_dir(), safe_filename)
    if not os.path.exists(pdf_path):
        return jsonify({
            "success": False,
            "message": f"PDF file {filename} not found in data directory"
        }), 404

    if not indexing_lock.acquire(blocking=False):
        return jsonify({
            "success": False,
            "message": "Indexing already in progress"
        }), 409

    try:
        logger.info(f"Indexing {pdf_path}")
        indexer = PDFIndexer(pdf_path)

        # Reuse the already-loaded embedding model instead of loading a second copy
        if embedding_model is not None and embedding_model.model_loaded:
            indexer.embedding_model = embedding_model

        success = indexer.index()
    except Exception as e:
        logger.error(f"Error indexing document: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Error indexing document",
            "error": str(e)
        }), 500
    finally:
        indexing_lock.release()

    if not success:
        return jsonify({
            "success": False,
            "message": f"Indexing failed for {filename}"
        }), 500

    # Invalidate the retriever's cached vectors so the next query picks up
    # the freshly indexed document
    if retriever is not None:
        retriever.embeddings = None
        retriever.metadata = None

    logger.info(f"Indexing completed for {filename}")
    return jsonify({
        "success": True,
        "message": f"Indexing of {filename} completed successfully",
        "progress": 100
    })

if __name__ == "__main__":
    # Initialize models before starting the server
    initialize_models()
    
    # Run Flask app
    port = int(os.environ.get("PORT", 5050))
    # Bind to localhost by default — only the Express backend needs to reach
    # this server. In Docker, HOST=0.0.0.0 is set so other containers can connect.
    host = os.environ.get("HOST", "127.0.0.1")
    app.run(host=host, port=port, debug=False)
    
    logger.info(f"Model server running on port {port}")