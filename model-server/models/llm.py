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
from rag.errors import check_deadline, cap_wait

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

# Sampling defaults carried over from the old model-level generation_config —
# the unified google-genai SDK has no model-level config, so these ride along
# on every request's GenerateContentConfig.
DEFAULT_TOP_P = 0.95
DEFAULT_TOP_K = 40

# Model fallback chain. Each Gemini model has a SEPARATE quota counter, so
# when the primary hits a 429 (per-minute or daily), the request retries on
# a lower-grade model instead of burning 65s waits on a quota that can't
# recover. Ordered descending by generation — verified against the models
# list endpoint for a live key. Override with
# GEMINI_FALLBACK_MODELS="model-a,model-b".
def _fallback_models():
    configured = os.environ.get("GEMINI_FALLBACK_MODELS", "")
    if configured.strip():
        return [m.strip() for m in configured.split(",") if m.strip()]
    return [
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
    ]


class EmptyResponseError(RuntimeError):
    """The API returned a response with no text — safety block,
    RECITATION, or MAX_TOKENS with no parts. Treated as a tier failure
    so the request falls back to the next model instead of returning
    None (which callers used to persist as a literal "null" answer or
    crash on .strip())."""


def _is_model_unavailable(error):
    """Model-name errors (404 / unsupported) — the named model doesn't
    exist or can't generate, so hop the chain rather than failing or
    retrying a guaranteed repeat."""
    code = getattr(error, "code", None)
    if code == 404:
        return True
    message = str(error).lower()
    return ("not found" in message or "not supported" in message
            or "does not exist" in message)


class LLMModel:
    def __init__(self, model_name="gemini-3.8-flash"):
        """
        Initialize the LLM model.

        Args:
            model_name (str): Name of the Gemini model to use
        """
        self.model_name = model_name
        self.model_loaded = False
        self.client = None

    def load_model(self):
        """
        Load the model for inference.
        """
        try:
            # Shared configuration — raises a clear error when
            # GEMINI_API_KEY is missing. Returns the shared google-genai
            # client used for every generate_content call.
            self.client = configure_gemini()

            logger.info(f"Initializing Gemini API with model: {self.model_name}")

            self.model_loaded = True
            logger.info("Gemini API initialized successfully")
            return True
        except Exception as e:
            logger.error(f"Error loading model: {str(e)}")
            return False

    def generate(self, prompt, max_tokens=4096, temperature=0.2, deadline=None):
        """
        Generate text based on the prompt using Gemini API.

        Args:
            prompt (str): Input prompt
            max_tokens (int): Maximum number of tokens to generate
            temperature (float): Sampling temperature
            deadline: Optional time.monotonic() deadline from the caller.
                Checked before every retry attempt and used to cap retry
                sleeps — once it passes there is no point burning more of
                the fallback chain on an answer the client can't receive.

        Returns:
            str: Generated text — never None and never blank

        Raises:
            DeadlineExceeded: If the caller's time budget is blown
            RuntimeError: If the model cannot be loaded
            EmptyResponseError: If every tier returns a response with no
                text (safety block, RECITATION, MAX_TOKENS with no parts)
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

        from google.genai import types

        # Try the configured model first, then each fallback tier. A 429 on
        # one model doesn't touch the next model's quota, so a rate-limit
        # hop costs one rejected call rather than a 65s wait — especially
        # for daily-quota 429s which no wait can fix.
        models_to_try = [self.model_name] + [
            m for m in _fallback_models() if m != self.model_name
        ]
        last_error = None
        for model_index, model in enumerate(models_to_try):
            has_fallback = model_index < len(models_to_try) - 1
            # Each tier restarts the exponential backoff — a 503 on the
            # fallback shouldn't inherit the delay accumulated on the
            # primary.
            delay = INITIAL_BACKOFF_SECONDS
            for attempt in range(1, MAX_RETRIES + 1):
                # Hard stop on a blown budget — outside the try so the
                # generic handler can't classify it as a retryable API
                # error.
                check_deadline(deadline)
                try:
                    # Generate content with an explicit per-request timeout so a
                    # hung API call can't tie up a worker thread indefinitely
                    response = self.client.models.generate_content(
                        model=model,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            temperature=temperature,
                            max_output_tokens=max_tokens,
                            top_p=DEFAULT_TOP_P,
                            top_k=DEFAULT_TOP_K,
                            # HttpOptions.timeout is in MILLISECONDS
                            http_options=types.HttpOptions(
                                timeout=GENERATE_TIMEOUT_SECONDS * 1000
                            ),
                        ),
                    )

                    # response.text is None when the model produced no
                    # parts — safety block, RECITATION, or MAX_TOKENS.
                    # That's a failed attempt, not an answer.
                    text = response.text
                    if text is None or not text.strip():
                        raise EmptyResponseError(
                            f"{model} returned an empty response (safety "
                            f"block or no text parts)"
                        )
                    return text
                except Exception as e:
                    last_error = e
                    # Rate-limited on this tier — hop to the next model's
                    # separate quota instead of waiting this one out. A
                    # model that doesn't exist on this key gets the same
                    # treatment — retrying it can only fail again — and
                    # so does a blocked/empty response: the same prompt to
                    # the same model produces the same block.
                    if has_fallback and (isinstance(e, EmptyResponseError)
                                         or is_rate_limit_error(e)
                                         or _is_model_unavailable(e)):
                        if isinstance(e, EmptyResponseError):
                            reason = "returned an empty response"
                        elif is_rate_limit_error(e):
                            reason = "rate-limited"
                        else:
                            reason = "unavailable"
                        logger.warning(
                            f"{model} {reason} — falling back to "
                            f"{models_to_try[model_index + 1]} for this request"
                        )
                        break
                    # Non-retryable errors (400-class rejections, a block on
                    # the last tier) fail identically on every attempt —
                    # surface them immediately.
                    if attempt == MAX_RETRIES or not is_retryable_error(e):
                        logger.error(f"Error generating text: {str(e)}")
                        raise
                    # Per-minute quota exhaustion needs a long wait, not jitter —
                    # regular transient errors keep the short exponential backoff.
                    wait = RATE_LIMIT_WAIT_SECONDS if is_rate_limit_error(e) else delay
                    wait = cap_wait(wait, deadline)
                    logger.warning(
                        f"LLM request failed (attempt {attempt}/{MAX_RETRIES}): {str(e)[:200]} — "
                        f"retrying in {wait:.0f}s"
                    )
                    time.sleep(wait)
                    delay *= 2
        raise last_error
