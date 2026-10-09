"""
Tests for rag/classifier.py.

The module imports cleanly (stdlib only at module level — the heavy
models.llm import happens lazily in __init__ and only when llm=None),
so we inject a fake LLM to test the classify() logic.
"""
import pytest

from rag.classifier import IntentClassifier


class FakeLLM:
    """Minimal stand-in for models.llm.LLMModel — records calls, returns
    a canned response (or raises a canned exception)."""

    def __init__(self, response="information-seeking"):
        self.response = response
        self.calls = []

    def generate(self, prompt, max_tokens=None):
        self.calls.append({"prompt": prompt, "max_tokens": max_tokens})
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def make_classifier(response="information-seeking"):
    llm = FakeLLM(response)
    return IntentClassifier(llm=llm), llm


class TestClassify:
    def test_conversational(self):
        clf, _ = make_classifier("conversational")
        result = clf.classify("Hey, how are you?")
        assert result == {"type": "conversational", "confidence": 0.9}

    def test_information_seeking(self):
        clf, _ = make_classifier("information-seeking")
        result = clf.classify("When was the Great Pyramid built?")
        assert result == {"type": "information-seeking", "confidence": 0.9}

    def test_schedule_seeking(self):
        clf, _ = make_classifier("schedule-seeking")
        result = clf.classify("Plan a 3-day Cairo itinerary")
        assert result == {"type": "schedule-seeking", "confidence": 0.9}

    def test_response_normalized_case_and_whitespace(self):
        clf, _ = make_classifier("  CONVERSATIONAL  \n")
        assert clf.classify("hi")["type"] == "conversational"

    def test_ambiguous_response_defaults_to_information_seeking(self):
        clf, _ = make_classifier("I have no idea")
        result = clf.classify("???")
        assert result == {"type": "information-seeking", "confidence": 0.6}

    def test_llm_exception_defaults_to_information_seeking(self):
        clf, _ = make_classifier(RuntimeError("LLM down"))
        result = clf.classify("anything")
        assert result == {"type": "information-seeking", "confidence": 0.5}

    def test_query_is_embedded_in_prompt(self):
        clf, llm = make_classifier("conversational")
        clf.classify("unique-query-marker-42")
        assert llm.calls, "LLM was never called"
        assert "unique-query-marker-42" in llm.calls[0]["prompt"]
