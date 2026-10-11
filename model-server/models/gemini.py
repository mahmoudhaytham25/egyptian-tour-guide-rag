import time
import threading

from rag.errors import cap_wait
from rag.utils.env_loader import get_api_key

# Per-minute quota exhaustion needs a long wait, not jitter — the Gemini
# free-tier quotas reset every 60s, so 429 retries wait just over a minute.
RATE_LIMIT_WAIT_SECONDS = 65.0

# Shared google-genai client — built once per process so the embedding and
# generation calls share its connection pool (the client is thread-safe).
# Constructed lazily so importing this module requires neither an API key
# nor the SDK to be installed.
_client = None
_client_lock = threading.Lock()


def configure_gemini():
    """
    Build the shared google-genai client with the configured API key.

    Both the embedding and the LLM model call the remote Gemini API, so the
    get_api_key → genai.Client dance lives here once instead of being
    duplicated in every load_model(). The client is cached — subsequent
    callers reuse the same instance.

    Returns:
        google.genai.Client: The configured shared client

    Raises:
        RuntimeError: If GEMINI_API_KEY is not set
    """
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is not None:
            return _client
        api_key = get_api_key("GEMINI_API_KEY", prompt_if_missing=False)
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY is not set — configure it in the environment or .env file"
            )

        # google-genai must be installed (see requirements.txt)
        from google import genai
        _client = genai.Client(api_key=api_key)
        return _client


def _error_status_code(error):
    """
    HTTP status code carried by google-genai errors — APIError and its
    subclasses (ClientError for 4xx, ServerError for 5xx) expose .code.
    Returns None for non-SDK exceptions such as socket timeouts and
    connection failures, which fall back to string matching.
    """
    code = getattr(error, "code", None)
    return code if isinstance(code, int) and code > 0 else None


def is_rate_limit_error(error):
    """
    True when the error is a per-minute quota/rate-limit (429) hit, which
    needs the long RATE_LIMIT_WAIT_SECONDS wait rather than short backoff.
    """
    code = _error_status_code(error)
    if code is not None:
        return code == 429
    message = str(error).lower()
    return "429" in message or "quota" in message


def is_retryable_error(error):
    """
    Decide whether a Gemini API failure is worth retrying.

    Rate limits (429), server errors (5xx), and timeouts/deadlines are
    transient. Client errors (other 4xx rejections: invalid arguments,
    permission denied, not found) fail identically on every attempt, so
    retrying them just burns MAX_RETRIES waits before surfacing the same
    error. Non-SDK errors without an HTTP status keep the legacy string
    matching.
    """
    code = _error_status_code(error)
    if code is not None:
        return code == 429 or code >= 500

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


def retry_sleep(error, delay, deadline, logger, label):
    """Sleep before the next retry attempt and return the doubled backoff.

    Per-minute quota exhaustion (429) waits out RATE_LIMIT_WAIT_SECONDS;
    other transient errors use the caller's current exponential backoff.
    The wait is capped at the time left before deadline so a blown budget
    can't be slept through, and warn-logged under the caller's label
    (e.g. "Embedding request failed (attempt 2/5)").

    Returns:
        float: The next backoff delay (delay * 2)
    """
    wait = RATE_LIMIT_WAIT_SECONDS if is_rate_limit_error(error) else delay
    wait = cap_wait(wait, deadline)
    logger.warning(f"{label}: {str(error)[:200]} — retrying in {wait:.0f}s")
    time.sleep(wait)
    return delay * 2
