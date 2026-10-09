"""
Tests for rag/utils/file_utils.py — pure stdlib module, no heavy deps.
"""
import json
import os

import pytest

from rag.utils.file_utils import (
    chunk_list,
    ensure_directory,
    get_data_dir,
    get_project_root,
    get_vector_store_dir,
    load_json,
    save_json,
)


class TestProjectPaths:
    def test_get_project_root_is_the_model_server_dir(self):
        root = get_project_root()
        assert os.path.isdir(root)
        assert os.path.basename(os.path.normpath(root)) == "model-server"
        # Sanity: the rag package should live directly under the root
        assert os.path.isdir(os.path.join(root, "rag"))

    def test_get_data_dir_is_data_under_root(self):
        data_dir = get_data_dir()
        assert data_dir == os.path.join(get_project_root(), "data")

    def test_get_vector_store_dir_creates_directory(self):
        vector_dir = get_vector_store_dir()
        assert os.path.isdir(vector_dir)
        assert vector_dir == os.path.join(get_project_root(), "vector_store")


class TestChunkList:
    def test_even_split(self):
        assert chunk_list([1, 2, 3, 4, 5, 6], 3) == [[1, 2, 3], [4, 5, 6]]

    def test_remainder_chunk(self):
        assert chunk_list([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]

    def test_batch_larger_than_list(self):
        assert chunk_list([1, 2], 10) == [[1, 2]]

    def test_empty_list(self):
        assert chunk_list([], 3) == []

    def test_batch_size_one(self):
        assert chunk_list(["a", "b", "c"], 1) == [["a"], ["b"], ["c"]]


class TestEnsureDirectory:
    def test_creates_missing_directory(self, tmp_path):
        target = tmp_path / "nested" / "dir"
        result = ensure_directory(str(target))
        assert os.path.isdir(target)
        assert result == str(target)

    def test_existing_directory_is_idempotent(self, tmp_path):
        target = tmp_path / "exists"
        target.mkdir()
        assert ensure_directory(str(target)) == str(target)
        assert os.path.isdir(target)


class TestJsonRoundTrip:
    def test_save_then_load_returns_same_data(self, tmp_path):
        data = {"name": "Giza", "chunks": [1, 2, 3], "nested": {"ok": True}}
        file_path = tmp_path / "out.json"

        assert save_json(data, str(file_path)) is True
        assert load_json(str(file_path)) == data

    def test_saved_file_is_valid_pretty_json(self, tmp_path):
        file_path = tmp_path / "out.json"
        save_json({"a": 1}, str(file_path))
        with open(file_path) as f:
            assert json.load(f) == {"a": 1}
        # indent=2 means newlines are written
        assert "\n" in file_path.read_text()

    def test_load_missing_file_returns_none(self, tmp_path):
        assert load_json(str(tmp_path / "nope.json")) is None

    def test_load_invalid_json_returns_none(self, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text("{not valid json")
        assert load_json(str(bad)) is None

    def test_save_to_unwritable_path_returns_false(self, tmp_path):
        # Parent directory doesn't exist and save_json must not raise
        missing_dir_file = tmp_path / "no-such-dir" / "out.json"
        assert save_json({"a": 1}, str(missing_dir_file)) is False
