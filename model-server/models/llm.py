import os
import sys
import time
import logging

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.gemini import (
    configure_gemini,
    is_rate_limit_error,
    is_retryable_error,
    RATE_LIMIT_WAIT_SECONDS,
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Per-request timeout (seconds) for Gemini generate_content calls, so a hung
# API request can't block a gunicorn worker thread forever.
GENERATE_TIMEOUT_SECONDS = 120

# Retry policy — mirrors models/embedding.py: a 429 means the per-minute
# quota is exhausted and needs the long RATE_LIMIT_WAIT_SECONDS wait; other
# transient errors use short exponential backoff. Kept to 1-2 retries so a
# mid-query hiccup doesn't blow the request's latency budget.
MAX_RETRIES = 3
INITIAL_BACKOFF_SECONDS = 2.0

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
            # Shared configuration — raises a clear error when
            # GEMINI_API_KEY is missing.
            self.api_key = configure_gemini()

            # google-generativeai must be installed (see requirements.txt)
            import google.generativeai as genai

            logger.info(f"Initializing Gemini API with model: {self.model_name}")

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
            Exception: Propagates Gemini API errors once retries are
                exhausted (or immediately for non-retryable failures).
                Callers must handle failures and produce a user-facing
                fallback — the error string is never safe to return as
                answer text (it used to be rendered to users and saved to
                MongoDB).
        """
        if not self.model_loaded:
            if not self.load_model():
                raise RuntimeError("Failed to load the LLM model")

        delay = INITIAL_BACKOFF_SECONDS
        for attempt in range(1, MAX_RETRIES + 1):
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
                # Non-retryable errors (400-class rejections) fail
                # identically on every attempt — surface them immediately.
                if attempt == MAX_RETRIES or not is_retryable_error(e):
                    logger.error(f"Error generating text: {str(e)}")
                    raise
                # Per-minute quota exhaustion needs a long wait, not jitter —
                # regular transient errors keep the short exponential backoff.
                wait = RATE_LIMIT_WAIT_SECONDS if is_rate_limit_error(e) else delay
                logger.warning(
                    f"LLM request failed (attempt {attempt}/{MAX_RETRIES}): {str(e)[:200]} — "
                    f"retrying in {wait:.0f}s"
                )
                time.sleep(wait)
                delay *= 2
