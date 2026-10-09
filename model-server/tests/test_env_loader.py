"""
Tests for rag/utils/env_loader.py.

Only dependency is python-dotenv. We never call get_api_key with
prompt_if_missing=True in tests, so input() can never block.
"""
from rag.utils.env_loader import get_api_key, load_environment


class TestGetApiKey:
    def test_returns_env_var_when_set(self, monkeypatch):
        monkeypatch.setenv("TEST_KEY_ABC", "secret-123")
        assert get_api_key("TEST_KEY_ABC", prompt_if_missing=False) == "secret-123"

    def test_returns_none_when_missing_and_prompt_disabled(self, monkeypatch):
        monkeypatch.delenv("DEFINITELY_MISSING_KEY", raising=False)
        assert get_api_key("DEFINITELY_MISSING_KEY", prompt_if_missing=False) is None

    def test_prompting_path_uses_input_and_sets_env(self, monkeypatch):
        # Verify the prompt path works without blocking — patch input()
        monkeypatch.delenv("PROMPTED_KEY", raising=False)
        monkeypatch.setattr("builtins.input", lambda _prompt: "typed-key")

        assert get_api_key("PROMPTED_KEY", prompt_if_missing=True) == "typed-key"

        import os
        assert os.environ["PROMPTED_KEY"] == "typed-key"


class TestLoadEnvironment:
    def test_returns_bool(self):
        # Whether or not a .env exists in the repo, it must return a bool
        # and must not raise.
        assert isinstance(load_environment(), bool)
