import os
import logging
import json
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def ensure_directory(directory_path):
    """Ensure a directory exists, create if it doesn't."""
    os.makedirs(directory_path, exist_ok=True)
    return directory_path

def save_json(data, file_path):
    """Save data as JSON to the specified file path."""
    try:
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Error saving JSON: {str(e)}")
        return False

def load_json(file_path):
    """Load JSON data from the specified file path."""
    try:
        if not os.path.exists(file_path):
            return None
        with open(file_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading JSON: {str(e)}")
        return None

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

def chunk_list(lst, batch_size):
    """Split a list into chunks of specified size."""
    return [lst[i:i + batch_size] for i in range(0, len(lst), batch_size)]