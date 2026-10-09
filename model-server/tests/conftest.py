"""
Pytest configuration for the model-server test suite.

Inserts the model-server directory on sys.path so `rag`, `models` and
`model_server` resolve without installing the package.
"""
import os
import sys

MODEL_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if MODEL_SERVER_DIR not in sys.path:
    sys.path.insert(0, MODEL_SERVER_DIR)
