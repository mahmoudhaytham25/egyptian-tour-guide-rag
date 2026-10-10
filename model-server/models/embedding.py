import os
import sys
import time
import logging
import numpy as np
from tqdm import tqdm

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.gemini import (
    configure_gemini,
    is_rate_limit_error,
    is_retryable_error,
    RATE_LIMIT_WAIT_SECONDS,
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Gemini embedding model — served remotely, no local model download.
# NOTE: text-embedding-004 was retired; gemini-embedding-001 is the GA model.
DEFAULT_MODEL_NAME = "models/gemini-embedding-001"

# Request 768-dim vectors (gemini-embedding-001 also supports 1536/3072).
OUTPUT_DIMENSIONALITY = 768

# embed_content accepts at most 100 texts per request.
MAX_BATCH_SIZE = 100

# Retry policy. Free-tier embedding quota is 100 units/min and each text in a
# batch counts — a full batch can consume an entire minute's budget, so 429s
# need ~60s waits (RATE_LIMIT_WAIT_SECONDS, shared via models.gemini), not
# the usual short backoff.
MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 2.0

# Per-request timeout for each embed_content call. Worst case per batch is
# MAX_RETRIES * EMBED_TIMEOUT_SECONDS plus the sleeps between attempts
# (up to ~4 * 65s when persistently rate-limited), which is bounded —
# persistent failures surface as an indexing failure rather than a hung
# worker thread.
EMBED_TIMEOUT_SECONDS = 60


class EmbeddingModel:
    def __init__(self, model_name=DEFAULT_MODEL_NAME, model_path=None):
        """
        Initialize the embedding model.

        Embeddings are generated remotely via the Gemini API, so "loading"
        only means configuring the API key — nothing is downloaded.

        Args:
            model_name (str): Gemini embedding model to use
            model_path (str): Unused — kept for backward compatibility with
                the old local-model signature
        """
        self.model_name = model_name
        self.model_loaded = False
        self.api_key = None

    def load_model(self):
        """
        Configure the Gemini embeddings API.

        Returns True if a GEMINI_API_KEY is configured, False otherwise —
        embeddings now require the API key plus network access, matching the
        error style used by models/llm.py.
        """
        try:
            # Shared configuration — raises a clear error when
            # GEMINI_API_KEY is missing instead of falling through to a
            # chain of dead fallback branches.
            self.api_key = configure_gemini()

            logger.info(f"Configuring Gemini embeddings API with model: {self.model_name}")

            self.model_loaded = True
            logger.info("Gemini embeddings API configured successfully")
            return True
        except Exception as e:
            logger.error(f"Error loading model: {str(e)}")
            return False

    def _embed_batch(self, texts, task_type):
        """
        Call embed_content for one batch (<= MAX_BATCH_SIZE texts) with
        retry/backoff on transient failures.

        Returns:
            list: List of embedding vectors (one per input text)
        """
        import google.generativeai as genai

        delay = INITIAL_BACKOFF_SECONDS
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                result = genai.embed_content(
                    model=self.model_name,
                    content=texts,
                    task_type=task_type,
                    output_dimensionality=OUTPUT_DIMENSIONALITY,
                    request_options={"timeout": EMBED_TIMEOUT_SECONDS},
                )
                return result["embedding"]
            except Exception as e:
                # Non-retryable errors (400-class rejections) fail
                # identically on every attempt — surface them immediately
                # instead of burning MAX_RETRIES waits.
                if attempt == MAX_RETRIES or not is_retryable_error(e):
                    raise
                # Per-minute quota exhaustion needs a long wait, not jitter —
                # regular transient errors keep the short exponential backoff.
                wait = RATE_LIMIT_WAIT_SECONDS if is_rate_limit_error(e) else delay
                logger.warning(
                    f"Embedding request failed (attempt {attempt}/{MAX_RETRIES}): {str(e)[:200]} — "
                    f"retrying in {wait:.0f}s"
                )
                time.sleep(wait)
                delay *= 2

    @staticmethod
    def _normalize(embeddings):
        """
        L2-normalize a 2-D array of embedding vectors so that the downstream
        unnormalized dot product in the retriever behaves like cosine
        similarity. Zero vectors are left untouched to avoid division by zero.
        """
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1.0, norms)
        return embeddings / norms

    def get_embeddings(self, texts, batch_size=MAX_BATCH_SIZE, task_type="retrieval_document"):
        """
        Generate embeddings for a list of texts.

        Args:
            texts (list): List of texts to embed
            batch_size (int): Texts per API request (clamped to the API limit
                of 100)
            task_type (str): Gemini task type — "retrieval_document" for
                indexed chunks, "retrieval_query" for queries

        Returns:
            numpy.ndarray: Array of L2-normalized embeddings, or None on failure
        """
        if not self.model_loaded:
            if not self.load_model():
                return None

        try:
            # Clamp to the API's per-request limit
            batch_size = min(batch_size, MAX_BATCH_SIZE)

            all_embeddings = []
            for i in tqdm(range(0, len(texts), batch_size), desc="Embedding batches"):
                batch_texts = texts[i:i + batch_size]
                batch_embeddings = self._embed_batch(batch_texts, task_type)
                all_embeddings.append(np.asarray(batch_embeddings, dtype=np.float32))

            embeddings = np.vstack(all_embeddings)
            return self._normalize(embeddings)
        except Exception as e:
            logger.error(f"Error generating embeddings: {str(e)}")
            return None

    def get_query_embedding(self, query):
        """
        Generate embedding for a query.

        Args:
            query (str): Query text

        Returns:
            numpy.ndarray: L2-normalized query embedding, or None on failure
        """
        if not self.model_loaded:
            if not self.load_model():
                return None

        try:
            embedding = self._embed_batch([query], task_type="retrieval_query")
            embedding = np.asarray(embedding, dtype=np.float32)
            return self._normalize(embedding)[0]
        except Exception as e:
            logger.error(f"Error generating query embedding: {str(e)}")
            return None

# For testing
if __name__ == "__main__":
    embedding_model = EmbeddingModel()

    # Test with a simple example
    test_texts = ["Ancient Egypt was a civilization of ancient Northeast Africa."]
    print("Testing embedding model...")

    embeddings = embedding_model.get_embeddings(test_texts)
    if embeddings is not None:
        print(f"Embedding shape: {embeddings.shape}")
    else:
        print("Failed to generate embeddings.")

    query_embedding = embedding_model.get_query_embedding("Tell me about ancient Egypt")
    if query_embedding is not None:
        print(f"Query embedding shape: {query_embedding.shape}")
    else:
        print("Failed to generate query embedding.")
