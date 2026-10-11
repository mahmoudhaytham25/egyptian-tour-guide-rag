"""
Tests for models.llm.LLMModel — the rate-limit fallback chain.

All API calls are faked through a stub client injected directly into the
model instance; no network access or API key is needed. Rate-limit and
backoff sleeps are patched out where they'd otherwise slow the suite.
"""
import types
import time

import pytest

from models.llm import LLMModel, MAX_RETRIES


class FakeAPIError(Exception):
    """Stand-in for google.genai APIError — carries a .code int like the
    real ClientError (4xx) / ServerError (5xx) subclasses."""

    def __init__(self, code):
        super().__init__(f"fake error {code}")
        self.code = code


class StubModelsApi:
    """client.models stand-in — raises scripted errors per model name and
    records every model it was called with. A list value means the calls
    raise in sequence until the script runs out, then succeed."""

    def __init__(self, script=None):
        self.script = script or {}
        self.calls = []

    def generate_content(self, model=None, contents=None, config=None):
        self.calls.append(model)
        outcome = self.script.get(model)
        if isinstance(outcome, list):
            if outcome:
                raise outcome.pop(0)
        elif outcome is not None:
            raise outcome
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
