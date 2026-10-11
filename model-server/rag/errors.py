import time


class DeadlineExceeded(Exception):
    """Raised when the caller's time budget is already blown — stops
    issuing further Gemini calls to produce an answer the client could
    no longer receive anyway. Lives here (not rag.generator) so the
    model retry loops in models/ can raise it without a circular
    import."""


class RetrievalError(Exception):
    """Raised when retrieval genuinely can't happen — the vector store is
    missing/corrupt/generation-mismatched, or the query-embedding call
    failed. Distinct from an empty result list, which means the index
    loaded fine but no chunk cleared the similarity threshold. /query
    turns this into success:false so the backend never persists an
    ungrounded answer built on an empty context."""


def is_past(deadline):
    """True when the caller-supplied monotonic deadline has passed —
    the boolean form of check_deadline for optional-work decisions.
    None means no budget, so never past."""
    return deadline is not None and time.monotonic() >= deadline


def check_deadline(deadline):
    """Hard stop before another API attempt on a blown budget.

    deadline is a time.monotonic() value, or None for no budget.
    """
    if is_past(deadline):
        raise DeadlineExceeded("time budget exhausted")


def cap_wait(wait, deadline):
    """Cap a retry sleep at the time remaining before deadline so a
    65s rate-limit wait can't overshoot the caller's budget."""
    if deadline is None:
        return wait
    return min(wait, max(0.0, deadline - time.monotonic()))
