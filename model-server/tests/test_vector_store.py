"""
Tests for the vector-store pair: PDFIndexer.save_vectors and
Retriever.load_vectors/search — generation-stamp pairing and the
top_k<=0 guard. All filesystem access is redirected to tmp_path; no
model or API calls happen (search() short-circuits before embedding
when top_k is non-positive and load_vectors is exercised directly).
"""
import json

import numpy as np

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
