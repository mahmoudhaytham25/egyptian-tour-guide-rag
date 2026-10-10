import os
import sys

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag.utils.env_loader import get_api_key

# Per-minute quota exhaustion needs a long wait, not jitter — the Gemini
# free-tier quotas reset every 60s, so 429 retries wait just over a minute.
RATE_LIMIT_WAIT_SECONDS = 65.0


def configure_gemini():
    """
    Configure the google-generativeai client with the shared API key.

    Both the embedding and the LLM model call the remote Gemini API, so the
    get_api_key → genai.configure dance lives here once instead of being
    duplicated in every load_model().

    Returns:
        str: The configured API key

    Raises:
        RuntimeError: If GEMINI_API_KEY is not set
    """
    api_key = get_api_key("GEMINI_API_KEY", prompt_if_missing=False)
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set — configure it in the environment or .env file"
        )

    # google-generativeai must be installed (see requirements.txt)
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    return api_key


def is_rate_limit_error(error):
    """
    True when the error is a per-minute quota/rate-limit (429) hit, which
    needs the long RATE_LIMIT_WAIT_SECONDS wait rather than short backoff.
    """
    message = str(error).lower()
    return "429" in message or "quota" in message


def is_retryable_error(error):
    """
    Decide whether a Gemini API failure is worth retrying.

    Rate limits, server errors (5xx), and timeouts/deadlines are transient.
    Client errors (400-class rejections: invalid arguments, permission
    denied, not found) fail identically on every attempt, so retrying them
    just burns MAX_RETRIES waits before surfacing the same error.
    """
    message = str(error).lower()
    if is_rate_limit_error(error):
        return True
    non_retryable_markers = (
        "400", "401", "403", "404",
        "invalid", "permission", "not found",
    )
    if any(marker in message for marker in non_retryable_markers):
        return False
    retryable_markers = (
        "500", "502", "503", "504",
        "internal", "unavailable",
        "timeout", "timed out", "deadline",
    )
    return any(marker in message for marker in retryable_markers)
