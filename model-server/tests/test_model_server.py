"""
Tests for model_server.py Flask routes.

model_server is imported with INTERNAL_API_TOKEN set and a stubbed
google.genai module, so importing it (which runs
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

# Stub google.genai before anything imports it so a configured
# GEMINI_API_KEY in the test environment still can't reach the network.
# The real google-genai package may be installed — this stub only keeps
# client construction and API calls offline.
_fake_genai = types.ModuleType("google.genai")


class _FakeModelsApi:
    """client.models stand-in — every API call must fail loudly in tests."""

    def embed_content(self, *args, **kwargs):
        raise AssertionError("Gemini calls must not run in tests")

    def generate_content(self, *args, **kwargs):
        raise AssertionError("Gemini calls must not run in tests")


class _FakeClient:
    """genai.Client stand-in — constructible offline, API calls fail."""
    def __init__(self, *args, **kwargs):
        self.models = _FakeModelsApi()


class _FakeConfig:
    """kwargs-bag stand-in for the google.genai.types config objects."""
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


_fake_types = types.ModuleType("google.genai.types")
_fake_types.HttpOptions = _FakeConfig
_fake_types.EmbedContentConfig = _FakeConfig
_fake_types.GenerateContentConfig = _FakeConfig

_fake_genai.Client = _FakeClient
_fake_genai.types = _fake_types

sys.modules["google.genai"] = _fake_genai
sys.modules["google.genai.types"] = _fake_types

# `from google import genai` resolves the parent package first, so make sure
# a `google` module exists and its `genai` attribute points at the stub —
# this keeps the import working whether or not the real SDK is installed.
try:
    import google
except ImportError:
    google = types.ModuleType("google")
    google.__path__ = []
    sys.modules["google"] = google
google.genai = _fake_genai

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
        self.response = {"answer": "test answer", "sources": []}
        self.error = None

    def generate_response(self, query, top_k=10, chat_history=None, retriever=None, deadline=None):
        self.calls.append({
            "query": query,
            "top_k": top_k,
            "chat_history": chat_history,
            "retriever": retriever,
            "deadline": deadline,
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

    def test_thread_start_failure_releases_lock_and_500s(self, client, monkeypatch):
        (client.data_dir / "doc.pdf").write_text("pdf bytes")

        class _UnstartableThread:
            def __init__(self, *args, **kwargs):
                pass

            def start(self):
                raise RuntimeError("cannot start thread")

        monkeypatch.setattr(model_server.threading, "Thread", _UnstartableThread)
        resp = client.post("/index", json={"filename": "doc.pdf"}, headers=AUTH)
        assert resp.status_code == 500

        # The lock was handed back — a follow-up job can start, and the
        # job state reports the failure instead of stuck "indexing".
        assert not model_server.indexing_lock.locked()
        status = client.get("/index/status", headers=AUTH).get_json()
        assert status["status"] == "error"

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

    def test_retrieval_error_returns_success_false(self, client):
        # A broken store / dead embedding API is an error, not an
        # answer — the backend maps this to a 502 and persists nothing.
        touch_vectors(client.vector_store_dir, "egyptian_history")
        client.fake_generator.error = model_server.RetrievalError(
            "vector store could not be loaded")
        resp = client.post("/query", json={"query": "q"}, headers=AUTH)
        assert resp.status_code == 500
        body = resp.get_json()
        assert body["success"] is False
        assert "vector store" in body["error"]

    def test_corrupt_store_errors_instead_of_empty_context_answer(self, client):
        # touch_vectors leaves an empty .npz — it passes the
        # _document_is_indexed precheck but a real retriever can't load
        # it. Previously that silently produced an ungrounded
        # success:true answer; now the RetrievalError must surface.
        # The retriever's file attrs are pointed at tmp_path directly —
        # it resolves its store dir at construction from rag.retriever's
        # own get_vector_store_dir, which the client fixture doesn't patch.
        touch_vectors(client.vector_store_dir, "egyptian_history")

        retriever = model_server.Retriever(
            "egyptian_history", model_server.TIMES_NAME)
        retriever.vector_file = str(
            client.vector_store_dir / "egyptian_history_vectors.npz")
        retriever.metadata_file = str(
            client.vector_store_dir / "egyptian_history_metadata.json")
        with model_server.retrievers_lock:
            model_server.retrievers["egyptian_history"] = retriever

        def _retrieve_then_answer(query, top_k=10, retriever=None, **kwargs):
            retriever.search(query, top_k=top_k)
            return client.fake_generator.response

        client.fake_generator.generate_response = _retrieve_then_answer
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

    def test_timeout_ms_forwarded_as_monotonic_deadline(self, client):
        touch_vectors(client.vector_store_dir, "egyptian_history")
        before = time.monotonic()
        resp = client.post("/query", json={"query": "q", "timeout_ms": 5000},
                           headers=AUTH)
        after = time.monotonic()
        assert resp.status_code == 200
        deadline = client.fake_generator.calls[0]["deadline"]
        assert before + 5 <= deadline <= after + 5

    def test_no_timeout_ms_means_no_deadline(self, client):
        touch_vectors(client.vector_store_dir, "egyptian_history")
        resp = client.post("/query", json={"query": "q"}, headers=AUTH)
        assert resp.status_code == 200
        assert client.fake_generator.calls[0]["deadline"] is None

    def test_timeout_ms_invalid_rejected(self, client):
        touch_vectors(client.vector_store_dir, "egyptian_history")
        for bad in (0, -5, "5000", True, 99999999):
            resp = client.post(
                "/query", json={"query": "q", "timeout_ms": bad}, headers=AUTH)
            assert resp.status_code == 400, bad
        assert client.fake_generator.calls == []

    def test_deadline_exceeded_returns_504(self, client):
        touch_vectors(client.vector_store_dir, "egyptian_history")
        client.fake_generator.error = model_server.DeadlineExceeded(
            "budget blown")
        resp = client.post("/query", json={"query": "q"}, headers=AUTH)
        assert resp.status_code == 504
        body = resp.get_json()
        assert body["success"] is False
        assert "budget" in body["error"]

    def test_generator_deadline_helpers(self):
        # __new__ skips __init__ so no models are constructed — the helpers
        # are pure deadline math.
        g = model_server.Generator.__new__(model_server.Generator)
        assert not g._over_deadline(None)
        g._check_deadline(time.monotonic() + 60)  # future — no raise
        with pytest.raises(model_server.DeadlineExceeded):
            g._check_deadline(time.monotonic() - 1)

    def test_schedule_keyword_route(self):
        g = model_server.Generator.__new__(model_server.Generator)
        assert g._is_schedule_query("Plan a Thursday itinerary in Luxor")
        assert g._is_schedule_query("what's a good schedule for Cairo on Sunday?")
        assert not g._is_schedule_query("When was the Great Pyramid built?")
        assert not g._is_schedule_query("hello, how are you?")
