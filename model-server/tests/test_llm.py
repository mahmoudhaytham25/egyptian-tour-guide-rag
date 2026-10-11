"""
Tests for models.llm.LLMModel — the rate-limit fallback chain.

All API calls are faked through a stub client injected directly into the
model instance; no network access or API key is needed. Rate-limit and
backoff sleeps are patched out where they'd otherwise slow the suite.
"""
import types
import time

import pytest

from models.llm import LLMModel, EmptyResponseError, MAX_RETRIES
from rag.errors import DeadlineExceeded


class FakeAPIError(Exception):
    """Stand-in for google.genai APIError — carries a .code int like the
    real ClientError (4xx) / ServerError (5xx) subclasses."""

    def __init__(self, code):
        super().__init__(f"fake error {code}")
        self.code = code


class StubModelsApi:
    """client.models stand-in — raises scripted errors per model name and
    records every model it was called with. A list value means the calls
    run the script in sequence until it runs out, then succeed. List
    items or dict values that aren't Exceptions are returned as the
    response (for scripted empty/blocked replies)."""

    def __init__(self, script=None):
        self.script = script or {}
        self.calls = []

    def generate_content(self, model=None, contents=None, config=None):
        self.calls.append(model)
        outcome = self.script.get(model)
        if isinstance(outcome, list):
            if outcome:
                outcome = outcome.pop(0)
            else:
                outcome = None
        if isinstance(outcome, Exception):
            raise outcome
        if outcome is not None:
            return outcome
        return types.SimpleNamespace(text=f"answer from {model}")


def make_model(script):
    """LLMModel with a stubbed client — skips load_model entirely."""
    api = StubModelsApi(script)
    model = LLMModel()
    model.model_loaded = True
    model.client = types.SimpleNamespace(models=api)
    return model, api


class TestFallbackChain:
    def test_primary_succeeds_no_fallback_calls(self):
        model, api = make_model({})
        assert model.generate("p") == "answer from gemini-3.8-flash"
        assert api.calls == ["gemini-3.8-flash"]

    def test_429_on_primary_hops_to_next_tier(self):
        model, api = make_model({"gemini-3.8-flash": FakeAPIError(429)})
        assert model.generate("p") == "answer from gemini-3.7-flash"
        assert api.calls == ["gemini-3.8-flash", "gemini-3.7-flash"]

    def test_429_and_404_walk_down_the_chain(self):
        model, api = make_model({
            "gemini-3.8-flash": FakeAPIError(429),
            "gemini-3.7-flash": FakeAPIError(404),
        })
        assert model.generate("p") == "answer from gemini-3.6-flash"
        assert api.calls == [
            "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]

    def test_404_model_name_hops_instead_of_failing(self):
        # A stale/mistyped fallback entry must not kill the request.
        model, api = make_model({"gemini-3.8-flash": FakeAPIError(404)})
        assert model.generate("p") == "answer from gemini-3.7-flash"
        assert api.calls == ["gemini-3.8-flash", "gemini-3.7-flash"]

    def test_transient_503_retries_the_same_model(self, monkeypatch):
        monkeypatch.setattr(time, "sleep", lambda s: None)
        model, api = make_model({
            "gemini-3.8-flash": [FakeAPIError(503)],
        })
        assert model.generate("p") == "answer from gemini-3.8-flash"
        # Two calls, both on the primary — transient errors don't consume
        # a fallback hop.
        assert api.calls == ["gemini-3.8-flash", "gemini-3.8-flash"]

    def test_non_retryable_400_raises_without_fallback(self, monkeypatch):
        monkeypatch.setattr(time, "sleep", lambda s: None)
        model, api = make_model({"gemini-3.8-flash": FakeAPIError(400)})
        with pytest.raises(FakeAPIError):
            model.generate("p")
        # A client rejection fails identically on every model — one call.
        assert api.calls == ["gemini-3.8-flash"]

    def test_every_tier_rate_limited_raises_after_retries(self, monkeypatch):
        monkeypatch.setattr(time, "sleep", lambda s: None)
        script = {
            name: FakeAPIError(429)
            for name in [
                "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash",
                "gemini-3.5-flash", "gemini-3.5-flash-lite",
                "gemini-3.1-flash-lite", "gemini-3-flash-preview",
                "gemini-2.5-flash", "gemini-2.5-flash-lite",
            ]
        }
        model, api = make_model(script)
        with pytest.raises(FakeAPIError):
            model.generate("p")
        # Each tier is tried once; the last tier exhausts MAX_RETRIES.
        assert api.calls[:-MAX_RETRIES] == list(script.keys())[:-1]
        assert api.calls[-MAX_RETRIES:] == ["gemini-2.5-flash-lite"] * MAX_RETRIES

    def test_env_override_replaces_chain(self, monkeypatch):
        monkeypatch.setenv(
            "GEMINI_FALLBACK_MODELS", "custom-a,custom-b")
        model, api = make_model({
            "gemini-3.8-flash": FakeAPIError(429),
            "custom-a": FakeAPIError(429),
        })
        assert model.generate("p") == "answer from custom-b"
        assert api.calls == ["gemini-3.8-flash", "custom-a", "custom-b"]

    def test_env_override_dedupes_primary(self, monkeypatch):
        # Naming the primary inside the override must not double-call it.
        monkeypatch.setenv(
            "GEMINI_FALLBACK_MODELS", "gemini-3.8-flash,custom-a")
        model, api = make_model({"gemini-3.8-flash": FakeAPIError(429)})
        assert model.generate("p") == "answer from custom-a"
        assert api.calls == ["gemini-3.8-flash", "custom-a"]


class TestEmptyResponse:
    """response.text is None on safety blocks / RECITATION / empty
    candidates — generate() must never return None to callers."""

    def test_none_text_hops_to_next_tier(self):
        model, api = make_model({
            "gemini-3.8-flash": types.SimpleNamespace(text=None),
        })
        assert model.generate("p") == "answer from gemini-3.7-flash"
        assert api.calls == ["gemini-3.8-flash", "gemini-3.7-flash"]

    def test_blank_text_hops_to_next_tier(self):
        model, api = make_model({
            "gemini-3.8-flash": types.SimpleNamespace(text="   "),
        })
        assert model.generate("p") == "answer from gemini-3.7-flash"
        assert api.calls == ["gemini-3.8-flash", "gemini-3.7-flash"]

    def test_empty_on_last_tier_raises(self, monkeypatch):
        monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "custom-a")
        model, api = make_model({
            "gemini-3.8-flash": types.SimpleNamespace(text=None),
            "custom-a": types.SimpleNamespace(text=None),
        })
        with pytest.raises(EmptyResponseError):
            model.generate("p")
        assert api.calls == ["gemini-3.8-flash", "custom-a"]

    def test_empty_response_does_not_retry_same_tier(self):
        # A safety block is deterministic for the same prompt+model —
        # retrying the tier can only reproduce it.
        model, api = make_model({
            "gemini-3.8-flash": types.SimpleNamespace(text=None),
        })
        model.generate("p")
        assert api.calls.count("gemini-3.8-flash") == 1


class TestDeadline:
    def test_blown_deadline_raises_before_any_call(self):
        model, api = make_model({})
        with pytest.raises(DeadlineExceeded):
            model.generate("p", deadline=time.monotonic() - 1)
        assert api.calls == []

    def test_deadline_aborts_between_retries(self, monkeypatch):
        # The budget expires after the first failed attempt — the retry
        # loop must stop instead of sleeping and retrying.
        sleeps = []
        monkeypatch.setattr(time, "sleep", sleeps.append)
        model, api = make_model({
            "gemini-3.8-flash": [FakeAPIError(503)] * MAX_RETRIES,
        })
        real_monotonic = time.monotonic
        calls = {"n": 0}

        def fake_monotonic():
            calls["n"] += 1
            # First two reads (deadline comparisons before attempt 1 and
            # the wait cap) are inside budget; everything after is blown.
            return real_monotonic() + (0 if calls["n"] <= 2 else 1000)

        monkeypatch.setattr(time, "monotonic", fake_monotonic)
        deadline = real_monotonic() + 60
        with pytest.raises(DeadlineExceeded):
            model.generate("p", deadline=deadline)
        assert api.calls == ["gemini-3.8-flash"]

    def test_no_deadline_still_retries(self, monkeypatch):
        monkeypatch.setattr(time, "sleep", lambda s: None)
        model, api = make_model({
            "gemini-3.8-flash": [FakeAPIError(503)],
        })
        assert model.generate("p") == "answer from gemini-3.8-flash"
        assert api.calls == ["gemini-3.8-flash", "gemini-3.8-flash"]


class TestBackoffReset:
    def test_delay_resets_between_tiers(self, monkeypatch):
        sleeps = []
        monkeypatch.setattr(time, "sleep", sleeps.append)
        model, api = make_model({
            # 503 → backoff sleep, then 429 → hop tiers
            "gemini-3.8-flash": [FakeAPIError(503), FakeAPIError(429)],
            # First attempt on the new tier must sleep the INITIAL
            # backoff, not the doubled value left over from the primary.
            "gemini-3.7-flash": [FakeAPIError(503)],
        })
        assert model.generate("p") == "answer from gemini-3.7-flash"
        assert sleeps == [2.0, 2.0]
