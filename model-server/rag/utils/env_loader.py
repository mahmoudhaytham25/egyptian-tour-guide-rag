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
    Get API key from environment variables
    If not found and prompt_if_missing is True, prompt user to enter it
    
    Args:
        key_name (str): Name of the environment variable
        prompt_if_missing (bool): Whether to prompt user if key is missing
        
    Returns:
        str: API key or None if not found
    """
    # Try to get key from environment
    api_key = os.environ.get(key_name)
    
    # If not found and prompt_if_missing is True, prompt user
    if not api_key and prompt_if_missing:
        print(f"\n{key_name} not found in environment variables.")
        api_key = input(f"Please enter your {key_name}: ").strip()
        
        if api_key:
            # Temporarily set for this session
            os.environ[key_name] = api_key
            print(f"\nNote: This key will only be saved for this session.")
            print(f"To save permanently, add it to your .env file:\n{key_name}=your_key_here\n")
    
    return api_key