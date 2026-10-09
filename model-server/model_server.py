import os
import sys
import json
import logging
from flask import Flask, request, jsonify

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.embedding import EmbeddingModel
from models.llm import LLMModel
from rag.retriever import Retriever
from rag.generator import Generator
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

def initialize_models():
    """Initialize and load all models at startup"""
    global embedding_model, llm_model, retriever, generator
    
    logger.info("Initializing models - this may take a minute...")
    
    # Get API key using our secure method
    api_key = get_api_key("GEMINI_API_KEY", prompt_if_missing=True)
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

if __name__ == "__main__":
    # Initialize models before starting the server
    initialize_models()
    
    # Run Flask app
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port, debug=False)
    
    logger.info(f"Model server running on port {port}")