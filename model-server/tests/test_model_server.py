"""
Tests for model_server.py Flask routes.

model_server is imported with INTERNAL_API_TOKEN set and a stubbed
google.generativeai module, so importing it (which runs
initialize_models) can never hit the network. The generator and the
embedding model are then replaced with fakes per test, and all
filesystem lookups (data dir, vector-store dir) are redirected to a
tmp dir.
"""
import os
import sys
import threading
import time
import types

import pytest

# Required env — model_server refuses to import without it
os.environ["INTERNAL_API_TOKEN"] = "test-internal-token"

# Stub google.generativeai before anything imports it so a configured
# GEMINI_API_KEY in the test environment still can't reach the network
_fake_genai = types.ModuleType("google.generativeai")
_fake_genai.configure = lambda *args, **kwargs: None


class _FakeGenerativeModel:
    def __init__(self, *args, **kwargs):
        pass

    def generate_content(self, *args, **kwargs):
        raise AssertionError("Gemini calls must not run in tests")


_fake_genai.GenerativeModel = _FakeGenerativeModel
sys.modules["google.generativeai"] = _fake_genai

import model_server

AUTH = {"X-Internal-Token": "test-internal-token"}


class FakeEmbeddingModel:
    """Stand-in for EmbeddingModel — reports loaded so the indexing
    worker reuses it, but embed calls must never happen in tests."""
    model_loaded = True

    def get_embeddings(self, texts, *args, **kwargs):
        raise AssertionError("Gemini calls must not run in tests")

    def get_query_embedding(self, query):
        raise AssertionError("Gemini calls must not run in tests")


class FakeGenerator:
    """Stand-in for Generator — records generate_response calls and either
    returns a canned response dict or raises a canned error."""
    def __init__(self):
        self.calls = []
        self.response = {"answer": "test answer", "sources": [], "is_conversational": False}
        self.error = None

    def generate_response(self, query, top_k=10, chat_history=None, retriever=None):
        self.calls.append({
            "query": query,
            "top_k": top_k,
            "chat_history": chat_history,
            "retriever": retriever,
        })
        if self.error is not None:
            raise self.error
        return self.response


class FakeIndexer:
    """Stand-in for PDFIndexer — instant success."""
    def __init__(self, pdf_path):
        self.pdf_path = pdf_path
        self.embedding_model = None

    def index(self):
        return True


def make_blocking_indexer():
    """PDFIndexer stand-in that blocks inside index() until released —
    used to hold indexing_lock so a second POST /index must 409."""
    started = threading.Event()
    release = threading.Event()

    class _BlockingIndexer(FakeIndexer):
        def index(self):
            started.set()
            release.wait(timeout=10)
            return True

    return _BlockingIndexer, started, release


@pytest.fixture
def client(monkeypatch, tmp_path):
    """Flask test client with fakes wired in and fresh module state."""
    data_dir = tmp_path / "data"
    vector_store_dir = tmp_path / "vector_store"
    data_dir.mkdir()
    vector_store_dir.mkdir()

    fake_generator = FakeGenerator()
    monkeypatch.setattr(model_server, "generator", fake_generator)
    monkeypatch.setattr(model_server, "embedding_model", FakeEmbeddingModel())
    monkeypatch.setattr(model_server, "get_data_dir", lambda: str(data_dir))
    monkeypatch.setattr(model_server, "get_vector_store_dir", lambda: str(vector_store_dir))

    with model_server.retrievers_lock:
        model_server.retrievers.clear()
    with model_server._index_job_lock:
        model_server._index_job.clear()
        model_server._index_job.update({"status": "idle"})

    test_client = model_server.app.test_client()
    test_client.fake_generator = fake_generator
    test_client.data_dir = data_dir
    test_client.vector_store_dir = vector_store_dir
    yield test_client

    # If a failing test left a background job holding the lock, release it
    # so later tests don't see spurious 409s. threading.Lock has no owner
    # tracking, so any thread may release it (unlike RLock).
    if model_server.indexing_lock.locked():
        model_server.indexing_lock.release()


def touch_vectors(vector_store_dir, name):
    """Create vector-store files so a document counts as indexed."""
    (vector_store_dir / f"{name}_vectors.npz").write_bytes(b"")
    (vector_store_dir / f"{name}_metadata.json").write_text("[]")


def wait_for_status(client, expected, timeout=5.0):
    """Poll GET /index/status until it reports the expected state."""
    deadline = time.time() + timeout
    body = {}
    while time.time() < deadline:
        body = client.get("/index/status", headers=AUTH).get_json()
        if body.get("status") == expected:
            return body
        time.sleep(0.02)
    pytest.fail(f"/index/status never reached {expected!r} (last: {body})")


class TestAuth:
    def test_health_is_exempt(self):
        resp = model_server.app.test_client().get("/health")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "ok"

    def test_query_requires_token(self, client):
        assert client.post("/query", json={"query": "hi"}).status_code == 401

    def test_index_requires_token(self, client):
        assert client.post("/index", json={"filename": "x.pdf"}).status_code == 401

    def test_index_status_requires_token(self, client):
        assert client.get("/index/status").status_code == 401


class TestIndexValidation:
    def test_missing_filename(self, client):
        resp = client.post("/index", json={}, headers=AUTH)
        assert resp.status_code == 400

    def test_non_pdf_rejected(self, client):
        resp = client.post("/index", json={"filename": "notes.txt"}, headers=AUTH)
        assert resp.status_code == 400

    def test_path_traversal_rejected(self, client):
        resp = client.post("/index", json={"filename": "../secret.pdf"}, headers=AUTH)
        assert resp.status_code == 400

    def test_missing_pdf_404(self, client):
        resp = client.post("/index", json={"filename": "nope.pdf"}, headers=AUTH)
        assert resp.status_code == 404


class TestIndexAsync:
    def test_returns_202_and_completes(self, client, monkeypatch):
        (client.data_dir / "doc.pdf").write_text("pdf bytes")
        monkeypatch.setattr(model_server, "PDFIndexer", FakeIndexer)

        resp = client.post("/index", json={"filename": "doc.pdf"}, headers=AUTH)
        assert resp.status_code == 202
        body = resp.get_json()
        assert body["status"] == "indexing"
        assert body["filename"] == "doc.pdf"
        assert body["job_id"]

        status = wait_for_status(client, "done")
        assert status["job_id"] == body["job_id"]
        assert status["filename"] == "doc.pdf"

    def test_409_while_indexing(self, client, monkeypatch):
        (client.data_dir / "doc.pdf").write_text("pdf bytes")
        BlockingIndexer, started, release = make_blocking_indexer()
        monkeypatch.setattr(model_server, "PDFIndexer", BlockingIndexer)
        try:
            first = client.post("/index", json={"filename": "doc.pdf"}, headers=AUTH)
            assert first.status_code == 202
            assert started.wait(timeout=5), "indexing worker never started"

            second = client.post("/index", json={"filename": "doc.pdf"}, headers=AUTH)
            assert second.status_code == 409
            assert "already in progress" in second.get_json()["error"]
        finally:
            release.set()
        wait_for_status(client, "done")

    def test_status_idle_before_any_job(self, client):
        resp = client.get("/index/status", headers=AUTH)
        assert resp.status_code == 200
        assert resp.get_json() == {"status": "idle"}

    def test_failed_index_reports_error_and_releases_lock(self, client, monkeypatch):
        (client.data_dir / "doc.pdf").write_text("pdf bytes")

        class _FailingIndexer(FakeIndexer):
            def index(self):
                return False

        monkeypatch.setattr(model_server, "PDFIndexer", _FailingIndexer)
        resp = client.post("/index", json={"filename": "doc.pdf"}, headers=AUTH)
        assert resp.status_code == 202

        status = wait_for_status(client, "error")
        assert status["error"]
        assert status["filename"] == "doc.pdf"

        # The lock must have been released — a follow-up job can start
        monkeypatch.setattr(model_server, "PDFIndexer", FakeIndexer)
        resp = client.post("/index", json={"filename": "doc.pdf"}, headers=AUTH)
        assert resp.status_code == 202
        wait_for_status(client, "done")

    def test_evicts_only_the_indexed_document(self, client, monkeypatch):
        touch_vectors(client.vector_store_dir, "egyptian_history")
        touch_vectors(client.vector_store_dir, "other_doc")

        # Populate the retriever cache for both documents
        assert client.post("/query", json={"query": "q1"}, headers=AUTH).status_code == 200
        assert client.post(
            "/query", json={"query": "q2", "document": "other_doc"}, headers=AUTH
        ).status_code == 200
        assert set(model_server.retrievers) == {"egyptian_history", "other_doc"}

        (client.data_dir / "egyptian_history.pdf").write_text("pdf bytes")
        monkeypatch.setattr(model_server, "PDFIndexer", FakeIndexer)
        resp = client.post("/index", json={"filename": "egyptian_history.pdf"}, headers=AUTH)
        assert resp.status_code == 202
        wait_for_status(client, "done")

        # Only the re-indexed document's retriever is evicted
        assert "other_doc" in model_server.retrievers
        assert "egyptian_history" not in model_server.retrievers


class TestQuery:
    def test_success_shape(self, client):
        touch_vectors(client.vector_store_dir, "egyptian_history")
        resp = client.post("/query", json={"query": "Tell me about pyramids"}, headers=AUTH)
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["query"] == "Tell me about pyramids"
        assert body["response"] == client.fake_generator.response

    def test_default_document_uses_default_retriever(self, client):
        touch_vectors(client.vector_store_dir, "egyptian_history")
        client.post("/query", json={"query": "q"}, headers=AUTH)
        call = client.fake_generator.calls[0]
        assert call["retriever"].pdf_name == "egyptian_history"

    def test_document_param_selects_retriever(self, client):
        touch_vectors(client.vector_store_dir, "other_doc")
        resp = client.post(
            "/query", json={"query": "q", "document": "other_doc"}, headers=AUTH
        )
        assert resp.status_code == 200
        assert client.fake_generator.calls[0]["retriever"].pdf_name == "other_doc"

    def test_unknown_document_returns_404(self, client):
        resp = client.post(
            "/query", json={"query": "q", "document": "no_such_doc"}, headers=AUTH
        )
        assert resp.status_code == 404
        body = resp.get_json()
        assert body["success"] is False
        assert "no_such_doc" in body["error"]

    def test_unindexed_default_document_returns_404(self, client):
        # Previously this silently answered with zero context
        resp = client.post("/query", json={"query": "q"}, headers=AUTH)
        assert resp.status_code == 404
        assert resp.get_json()["success"] is False

    def test_document_path_traversal_rejected(self, client):
        resp = client.post("/query", json={"query": "q", "document": "../x"}, headers=AUTH)
        assert resp.status_code == 400

    def test_generation_failure_returns_success_false(self, client):
        touch_vectors(client.vector_store_dir, "egyptian_history")
        client.fake_generator.error = RuntimeError("LLM exploded")
        resp = client.post("/query", json={"query": "q"}, headers=AUTH)
        assert resp.status_code == 500
        body = resp.get_json()
        assert body["success"] is False
        assert body["error"]

    def test_chat_history_sanitized(self, client):
        touch_vectors(client.vector_store_dir, "egyptian_history")
        resp = client.post("/query", json={
            "query": "q",
            "chat_history": [
                {"role": "user", "content": "first"},
                "garbage",
                {"role": "user"},
                {"role": 123, "content": "bad role"},
                {"role": "assistant", "content": "second"},
                {"role": "user", "content": None},
            ],
        }, headers=AUTH)
        assert resp.status_code == 200
        history = client.fake_generator.calls[0]["chat_history"]
        assert history == [
            {"role": "user", "content": "first"},
            {"role": "assistant", "content": "second"},
        ]

    def test_chat_history_non_list_rejected(self, client):
        touch_vectors(client.vector_store_dir, "egyptian_history")
        resp = client.post(
            "/query", json={"query": "q", "chat_history": "notalist"}, headers=AUTH
        )
        assert resp.status_code == 400

    def test_missing_query_rejected(self, client):
        resp = client.post("/query", json={}, headers=AUTH)
        assert resp.status_code == 400

    def test_top_k_out_of_range_rejected(self, client):
        resp = client.post("/query", json={"query": "q", "top_k": 99}, headers=AUTH)
        assert resp.status_code == 400
