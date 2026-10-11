"""
Tests for the vector-store pair: PDFIndexer.save_vectors and
Retriever.load_vectors/search — generation-stamp pairing, the
top_k<=0 guard, and the RetrievalError contract (a broken store or a
failed embedding call must raise, never masquerade as an empty result).
All filesystem access is redirected to tmp_path; no model or API calls
happen (search() short-circuits before embedding when top_k is
non-positive, load_vectors is exercised directly, and the embedding
model is stubbed wherever a search reaches it).
"""
import json

import numpy as np
import pytest

from rag.errors import DeadlineExceeded, RetrievalError
from rag.indexer import PDFIndexer
from rag.retriever import Retriever


def _make_indexer(tmp_path, name="doc"):
    indexer = PDFIndexer(str(tmp_path / f"{name}.pdf"))
    # mkstemp lands in vector_store_dir before os.replace — keep temps in
    # tmp_path too so the whole write stays inside the fixture dir.
    indexer.vector_store_dir = str(tmp_path)
    indexer.vector_file = str(tmp_path / f"{name}_vectors.npz")
    indexer.metadata_file = str(tmp_path / f"{name}_metadata.json")
    return indexer


def _make_retriever(tmp_path, name="doc"):
    retriever = Retriever(name)
    retriever.vector_file = str(tmp_path / f"{name}_vectors.npz")
    retriever.metadata_file = str(tmp_path / f"{name}_metadata.json")
    return retriever


def _save(indexer, n=3):
    embeddings = np.eye(n, dtype=np.float32)
    chunks = [
        {"id": str(i), "text": f"chunk {i}", "page_num": i + 1}
        for i in range(n)
    ]
    assert indexer.save_vectors(embeddings, chunks)


class TestSaveLoadRoundTrip:
    def test_save_then_load(self, tmp_path):
        indexer = _make_indexer(tmp_path)
        _save(indexer, n=3)

        retriever = _make_retriever(tmp_path)
        assert retriever.load_vectors()
        assert retriever.embeddings.shape == (3, 3)
        assert [c["text"] for c in retriever.metadata] == [
            "chunk 0", "chunk 1", "chunk 2"]

    def test_both_files_carry_the_same_generation(self, tmp_path):
        indexer = _make_indexer(tmp_path)
        _save(indexer)

        with np.load(indexer.vector_file) as npz:
            vectors_generation = npz["generation"].item()
        with open(indexer.metadata_file) as f:
            metadata_payload = json.load(f)

        assert metadata_payload["generation"] == vectors_generation
        assert len(metadata_payload["chunks"]) == 3


class TestGenerationMismatch:
    def test_new_vectors_with_legacy_metadata_fails(self, tmp_path):
        # Reader observes the new .npz beside a pre-generation metadata
        # file — one-sided stamping must not pass.
        indexer = _make_indexer(tmp_path)
        _save(indexer)
        (tmp_path / "doc_metadata.json").write_text(
            json.dumps([{"text": "old", "page_num": 1}]))
        assert not _make_retriever(tmp_path).load_vectors()

    def test_legacy_vectors_with_new_metadata_fails(self, tmp_path):
        indexer = _make_indexer(tmp_path)
        _save(indexer)
        np.savez(tmp_path / "doc_vectors.npz",
                 embeddings=np.eye(3, dtype=np.float32))
        assert not _make_retriever(tmp_path).load_vectors()

    def test_mismatched_generations_fail(self, tmp_path):
        np.savez(tmp_path / "doc_vectors.npz",
                 embeddings=np.eye(2, dtype=np.float32),
                 generation=np.array("gen-a"))
        (tmp_path / "doc_metadata.json").write_text(json.dumps(
            {"generation": "gen-b",
             "chunks": [{"text": "a"}, {"text": "b"}]}))
        assert not _make_retriever(tmp_path).load_vectors()

    def test_both_legacy_still_loads(self, tmp_path):
        np.savez(tmp_path / "doc_vectors.npz",
                 embeddings=np.eye(2, dtype=np.float32))
        (tmp_path / "doc_metadata.json").write_text(
            json.dumps([{"text": "a"}, {"text": "b"}]))
        retriever = _make_retriever(tmp_path)
        assert retriever.load_vectors()
        assert retriever.metadata == [{"text": "a"}, {"text": "b"}]


class _StubEmbeddingModel:
    """Returns a fixed query vector — no API access."""
    model_loaded = True

    def get_query_embedding(self, query, deadline=None):
        return np.ones(3, dtype=np.float32)


def _loaded_retriever(tmp_path):
    retriever = _make_retriever(tmp_path)
    retriever.embedding_model = _StubEmbeddingModel()
    retriever.embeddings = np.eye(3, dtype=np.float32)
    retriever.metadata = [{"text": "a"}, {"text": "b"}, {"text": "c"}]
    return retriever


class TestTopKGuard:
    def test_top_k_zero_returns_empty(self, tmp_path):
        # np.argsort(scores)[-0:] is the whole array — without the guard
        # this would return all three chunks.
        assert _loaded_retriever(tmp_path).search("q", top_k=0) == []

    def test_top_k_negative_returns_empty(self, tmp_path):
        assert _loaded_retriever(tmp_path).search("q", top_k=-3) == []

    def test_top_k_still_returns_results(self, tmp_path):
        results = _loaded_retriever(tmp_path).search("q", top_k=2)
        assert len(results) == 2


class TestSearchFailures:
    """Retrieval failures raise RetrievalError — [] is reserved for "the
    index loaded fine and nothing cleared the threshold"."""

    def test_missing_files_raise(self, tmp_path):
        # /query 404s unindexed documents upstream, but if a search still
        # reaches the loader (files removed after the precheck, a stale
        # cached retriever) the failure must not read as an empty result.
        retriever = _make_retriever(tmp_path)
        with pytest.raises(RetrievalError):
            retriever.search("q")

    def test_generation_mismatch_raises(self, tmp_path):
        # A reader mid-reindex observes mismatched generation stamps —
        # a corrupt pairing must error, not return "no relevant chunks".
        indexer = _make_indexer(tmp_path)
        _save(indexer)
        (tmp_path / "doc_metadata.json").write_text(json.dumps(
            {"generation": "gen-other",
             "chunks": [{"text": "a"}, {"text": "b"}, {"text": "c"}]}))
        retriever = _make_retriever(tmp_path)
        with pytest.raises(RetrievalError):
            retriever.search("q")

    def test_unreadable_vectors_raise(self, tmp_path):
        # Both files exist (the /query precheck passes) but the .npz is
        # garbage — load fails and the search surfaces it as an error.
        (tmp_path / "doc_vectors.npz").write_bytes(b"not an npz")
        (tmp_path / "doc_metadata.json").write_text("[]")
        retriever = _make_retriever(tmp_path)
        with pytest.raises(RetrievalError):
            retriever.search("q")

    def test_failed_load_does_not_leave_stale_state(self, tmp_path):
        # load_vectors assigns self.embeddings before the generation
        # check can raise — a failed load must still leave the retriever
        # unloaded so a later search can't score against partial data.
        indexer = _make_indexer(tmp_path)
        _save(indexer)
        (tmp_path / "doc_metadata.json").write_text(json.dumps(
            {"generation": "gen-other",
             "chunks": [{"text": "a"}, {"text": "b"}, {"text": "c"}]}))
        retriever = _make_retriever(tmp_path)
        with pytest.raises(RetrievalError):
            retriever.search("q")
        assert retriever.embeddings is None
        assert retriever.metadata is None

    def test_embedding_failure_raises(self, tmp_path):
        retriever = _loaded_retriever(tmp_path)

        class _DeadEmbedding:
            def get_query_embedding(self, query, deadline=None):
                return None

        retriever.embedding_model = _DeadEmbedding()
        with pytest.raises(RetrievalError):
            retriever.search("q")

    def test_deadline_exceeded_propagates_unwrapped(self, tmp_path):
        # Cancellation is not a retrieval failure — it must reach the
        # 504 handler unchanged, not collapse into RetrievalError.
        retriever = _loaded_retriever(tmp_path)

        class _DeadlineEmbedding:
            def get_query_embedding(self, query, deadline=None):
                raise DeadlineExceeded("budget blown")

        retriever.embedding_model = _DeadlineEmbedding()
        with pytest.raises(DeadlineExceeded):
            retriever.search("q")

    def test_below_threshold_still_returns_empty(self, tmp_path):
        # Successful load + a genuinely irrelevant query is a legitimate
        # empty result — the generator intentionally falls back to model
        # knowledge for these.
        retriever = _loaded_retriever(tmp_path)

        class _ZeroEmbedding:
            def get_query_embedding(self, query, deadline=None):
                return np.zeros(3, dtype=np.float32)

        retriever.embedding_model = _ZeroEmbedding()
        assert retriever.search("q") == []
