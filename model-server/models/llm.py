import os
import logging
import sys
from pathlib import Path

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag.utils.env_loader import get_api_key

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class LLMModel:
    def __init__(self, model_name="gemini-2.0-flash", model_path=None):
        """
        Initialize the LLM model.
        
        Args:
            model_name (str): Name of the model to use
            model_path (str): Path to store the model
        """
        self.model_name = model_name
        self.home_dir = str(Path.home())
        self.model_path = model_path or os.path.join(self.home_dir, "llm_models")
        self.model_loaded = False
        self.api_key = None
        
    def download_model(self):
        """
        Download necessary packages for Gemini API.
        """
        try:
            logger.info(f"Installing required packages for Gemini API...")
            
            # Install required packages
            try:
                import pip
                pip.main(['install', 'google-generativeai'])
                logger.info("Required packages installed successfully")
                return True
            except Exception as e:
                logger.error(f"Error installing packages: {str(e)}")
                return False
                
        except Exception as e:
            logger.error(f"Error in setup process: {str(e)}")
            return False
    
    def load_model(self):
        """
        Load the model for inference.
        """
        try:
            # Try custom loader first
            try:
                from rag.utils.env_loader import get_api_key
                self.api_key = get_api_key("GEMINI_API_KEY", prompt_if_missing=False)
            except ImportError:
                # Fallback to direct environment variable
                self.api_key = os.getenv("GEMINI_API_KEY")
                
            # Check if API key is available
            if not self.api_key:
                # Try loading from .env file directly
                try:
                    from dotenv import load_dotenv
                    load_dotenv()
                    self.api_key = os.getenv("GEMINI_API_KEY")
                except ImportError:
                    pass
                    
            if not self.api_key:
                logger.error("GEMINI_API_KEY not available. Please set it in your environment or .env file")
                return False           
            # First make sure required packages are installed
            try:
                import google.generativeai as genai
            except ImportError:
                logger.info("Required packages not found. Installing...")
                if not self.download_model():
                    return False
                import google.generativeai as genai
            
            logger.info(f"Initializing Gemini API with model: {self.model_name}")
            
            # Configure Gemini API
            genai.configure(api_key=self.api_key)
            
            # Initialize the model
            self.model = genai.GenerativeModel(self.model_name, 
                generation_config={
                    "temperature": 0.2,  # Lower temperature for RAG
                    "top_p": 0.95,
                    "top_k": 40,
                    "max_output_tokens": 1024,
                }
            )
            
            self.model_loaded = True
            logger.info("Gemini API initialized successfully")
            return True
        except Exception as e:
            logger.error(f"Error loading model: {str(e)}")
            return False
    
    def generate(self, prompt, max_tokens=512, temperature=0.2):
        """
        Generate text based on the prompt using Gemini API.
        
        Args:
            prompt (str): Input prompt
            max_tokens (int): Maximum number of tokens to generate
            temperature (float): Sampling temperature
            
        Returns:
            str: Generated text
        """
        if not self.model_loaded:
            if not self.load_model():
                return "Error: Failed to load the model."
        
        try:
            import google.generativeai as genai
            
            # Generate content
            response = self.model.generate_content(
                prompt,
                generation_config={
                    "temperature": temperature,
                    "max_output_tokens": max_tokens
                }
            )
            
            # Return the text response
            return response.text
        except Exception as e:
            logger.error(f"Error generating text: {str(e)}")
            return f"Error: {str(e)}"