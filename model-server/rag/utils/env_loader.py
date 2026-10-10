import os
import logging
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

def load_environment():
    """
    Load environment variables from .env file
    Returns True if successful, False otherwise
    """
    try:
        # Get the project root directory
        project_root = Path(__file__).parent.parent.parent
        env_path = project_root / '.env'
        
        # Load environment variables from .env file if it exists
        if env_path.exists():
            load_dotenv(dotenv_path=env_path)
            logger.info(f"Loaded environment variables from {env_path}")
            return True
        else:
            logger.warning(f"No .env file found at {env_path}")
            return False
    except Exception as e:
        logger.error(f"Error loading environment variables: {e}")
        return False

def get_api_key(key_name, prompt_if_missing=True):
    """
    Get API key from environment variables.

    Args:
        key_name (str): Name of the environment variable
        prompt_if_missing (bool): If True, raise when the key is missing
            instead of returning None. (This used to prompt via input(),
            but an interactive prompt can hang forever under a process
            supervisor, so it now fails fast with a clear error.)

    Returns:
        str: API key, or None if not found and prompt_if_missing is False

    Raises:
        RuntimeError: If the key is missing and prompt_if_missing is True
    """
    api_key = os.environ.get(key_name)

    if not api_key and prompt_if_missing:
        raise RuntimeError(
            f"{key_name} is not set in the environment. "
            f"Set it in the environment or add it to your .env file:\n"
            f"{key_name}=your_key_here"
        )

    return api_key