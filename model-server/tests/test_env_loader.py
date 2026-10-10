"""
Tests for rag/utils/env_loader.py.

Only dependency is python-dotenv. get_api_key used to prompt via input()
when prompt_if_missing=True — it now raises RuntimeError instead so it can
never block under a process supervisor.
"""
import pytest

from rag.utils.env_loader import get_api_key, load_environment


class TestGetApiKey:
    def test_returns_env_var_when_set(self, monkeypatch):
        monkeypatch.setenv("TEST_KEY_ABC", "secret-123")
        assert get_api_key("TEST_KEY_ABC", prompt_if_missing=False) == "secret-123"

    def test_returns_env_var_when_set_even_with_prompt_enabled(self, monkeypatch):
        monkeypatch.setenv("TEST_KEY_SET", "secret-xyz")
        assert get_api_key("TEST_KEY_SET", prompt_if_missing=True) == "secret-xyz"

    def test_returns_none_when_missing_and_prompt_disabled(self, monkeypatch):
        monkeypatch.delenv("DEFINITELY_MISSING_KEY", raising=False)
        assert get_api_key("DEFINITELY_MISSING_KEY", prompt_if_missing=False) is None

    def test_missing_key_raises_instead_of_prompting(self, monkeypatch):
        # The old code called input() here, which could hang a supervisor —
        # it must now fail fast with a clear error and never block.
        monkeypatch.delenv("MISSING_KEY", raising=False)
        monkeypatch.setattr(
            "builtins.input",
            lambda *_a, **_k: pytest.fail("input() must never be called"),
        )
        with pytest.raises(RuntimeError, match="MISSING_KEY"):
            get_api_key("MISSING_KEY", prompt_if_missing=True)


class TestLoadEnvironment:
    def test_returns_bool(self):
        # Whether or not a .env exists in the repo, it must return a bool
        # and must not raise.
        assert isinstance(load_environment(), bool)
