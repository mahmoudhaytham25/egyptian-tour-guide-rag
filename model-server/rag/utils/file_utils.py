import os
from pathlib import Path

def ensure_directory(directory_path):
    """Ensure a directory exists, create if it doesn't."""
    os.makedirs(directory_path, exist_ok=True)
    return directory_path

def get_project_root():
    """Get the project root directory."""
    return str(Path(__file__).parent.parent.parent)

def get_data_dir():
    """Get the data directory path."""
    return os.path.join(get_project_root(), "data")

def get_vector_store_dir():
    """Get the vector store directory path."""
    vector_dir = os.path.join(get_project_root(), "vector_store")
    ensure_directory(vector_dir)
    return vector_dir

def get_times_dir():
    """Get the times directory path."""
    times_dir = os.path.join(get_project_root(), "times_places")
    ensure_directory(times_dir)
    return times_dir

def vector_store_paths(name):
    """Return the (vectors .npz, metadata .json) path pair for a
    document name under the vector store directory — the single place
    the file naming scheme lives."""
    vector_dir = get_vector_store_dir()
    return (
        os.path.join(vector_dir, f"{name}_vectors.npz"),
        os.path.join(vector_dir, f"{name}_metadata.json"),
    )