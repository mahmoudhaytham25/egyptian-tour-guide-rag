import os
import logging
import numpy as np
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class EmbeddingModel:
    def __init__(self, model_name="all-MiniLM-L6-v2", model_path=None):
        """
        Initialize the embedding model.
        
        Args:
            model_name (str): Name of the model to use
            model_path (str): Path to store the model
        """
        self.model_name = model_name
        self.home_dir = str(Path.home())
        self.model_path = model_path or os.path.join(self.home_dir, "embedding_models")
        self.model_dir = os.path.join(self.model_path, model_name)
        self.model_loaded = False
        
    def download_model(self):
        """
        Download the embedding model.
        """
        try:
            # Create directory if it doesn't exist
            os.makedirs(self.model_path, exist_ok=True)
            
            logger.info(f"Installing sentence-transformers package...")
            
            # Install required dependencies
            try:
                import pip
                pip.main(['install', 'sentence-transformers'])
                logger.info("sentence-transformers installed successfully")
                return True
            except Exception as e:
                logger.error(f"Error installing sentence-transformers: {str(e)}")
                return False
                
        except Exception as e:
            logger.error(f"Error in download process: {str(e)}")
            return False
    
    def load_model(self):
        """
        Load the embedding model for inference.
        """
        try:
            # First, make sure sentence-transformers is installed
            try:
                import sentence_transformers
            except ImportError:
                logger.info("sentence-transformers not found. Installing...")
                if not self.download_model():
                    return False
            
            # Import here to avoid loading dependencies unless needed
            from sentence_transformers import SentenceTransformer
            
            # Load model
            logger.info(f"Loading model: {self.model_name}")
            self.model = SentenceTransformer(self.model_name)
            
            self.model_loaded = True
            logger.info(f"Model loaded successfully")
            return True
        except Exception as e:
            logger.error(f"Error loading model: {str(e)}")
            return False
    
    def get_embeddings(self, texts, batch_size=32):
        """
        Generate embeddings for a list of texts.
        
        Args:
            texts (list): List of texts to embed
            batch_size (int): Batch size for processing
            
        Returns:
            numpy.ndarray: Array of embeddings
        """
        if not self.model_loaded:
            if not self.load_model():
                return None
        
        try:
            # Process in batches to avoid OOM errors
            all_embeddings = []
            
            for i in range(0, len(texts), batch_size):
                batch_texts = texts[i:i+batch_size]
                
                # Compute embeddings
                embeddings = self.model.encode(batch_texts, show_progress_bar=True)
                
                # Add to list
                all_embeddings.append(embeddings)
            
            # Concatenate all batches
            return np.vstack(all_embeddings)
        except Exception as e:
            logger.error(f"Error generating embeddings: {str(e)}")
            return None
    
    def get_query_embedding(self, query):
        """
        Generate embedding for a query.
        
        Args:
            query (str): Query text
            
        Returns:
            numpy.ndarray: Query embedding
        """
        if not self.model_loaded:
            if not self.load_model():
                return None
        
        try:
            # Compute embedding
            embedding = self.model.encode([query])[0]
            
            # Return as numpy array
            return embedding
        except Exception as e:
            logger.error(f"Error generating query embedding: {str(e)}")
            return None

# For testing
if __name__ == "__main__":
    embedding_model = EmbeddingModel()
    
    # Test with a simple example
    test_texts = ["Ancient Egypt was a civilization of ancient Northeast Africa."]
    print("Testing embedding model...")
    
    embeddings = embedding_model.get_embeddings(test_texts)
    if embeddings is not None:
        print(f"Embedding shape: {embeddings.shape}")
    else:
        print("Failed to generate embeddings.")
    
    query_embedding = embedding_model.get_query_embedding("Tell me about ancient Egypt")
    if query_embedding is not None:
        print(f"Query embedding shape: {query_embedding.shape}")
    else:
        print("Failed to generate query embedding.")