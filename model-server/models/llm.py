import os
import logging
import sys

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag.utils.env_loader import get_api_key

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Per-request timeout (seconds) for Gemini generate_content calls, so a hung
# API request can't block a gunicorn worker thread forever.
GENERATE_TIMEOUT_SECONDS = 120

class LLMModel:
    def __init__(self, model_name="gemini-3.8-flash"):
        """
        Initialize the LLM model.

        Args:
            model_name (str): Name of the Gemini model to use
        """
        self.model_name = model_name
        self.model_loaded = False
        self.api_key = None

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
            # google-generativeai must be installed (see requirements.txt)
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

    def generate(self, prompt, max_tokens=4096, temperature=0.2):
        """
        Generate text based on the prompt using Gemini API.

        Args:
            prompt (str): Input prompt
            max_tokens (int): Maximum number of tokens to generate
            temperature (float): Sampling temperature

        Returns:
            str: Generated text

        Raises:
            RuntimeError: If the model cannot be loaded
            Exception: Propagates Gemini API errors. Callers must handle
                failures and produce a user-facing fallback — the error
                string is never safe to return as answer text (it used to
                be rendered to users and saved to MongoDB).
        """
        if not self.model_loaded:
            if not self.load_model():
                raise RuntimeError("Failed to load the LLM model")

        try:
            # Generate content with an explicit per-request timeout so a
            # hung API call can't tie up a worker thread indefinitely
            response = self.model.generate_content(
                prompt,
                generation_config={
                    "temperature": temperature,
                    "max_output_tokens": max_tokens
                },
                request_options={"timeout": GENERATE_TIMEOUT_SECONDS}
            )

            # Return the text response
            return response.text
        except Exception as e:
            logger.error(f"Error generating text: {str(e)}")
            raise
