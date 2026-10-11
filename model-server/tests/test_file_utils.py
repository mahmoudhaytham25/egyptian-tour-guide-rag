"""
Tests for rag/utils/file_utils.py — pure stdlib module, no heavy deps.
"""
import os

from rag.utils.file_utils import (
    ensure_directory,
    get_data_dir,
    get_project_root,
    get_vector_store_dir,
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
