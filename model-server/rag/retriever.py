import os
import sys
import csv
import logging
import functools
import numpy as np
import json
import re
import traceback

if __name__ == "__main__":
    # Standalone run — Python puts this file's directory on sys.path, not
    # the project root, so the package imports below need it added here.
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

from models.embedding import EmbeddingModel
from rag.constants import TIMES_NAME
from rag.errors import DeadlineExceeded, RetrievalError
from rag.utils import get_times_dir, vector_store_paths

logger = logging.getLogger(__name__)


@functools.lru_cache(maxsize=8)
def _load_times_records(times_file):
    """Read a monument schedule CSV once per path and pre-clean every row.

    The CSV is static data shipped with the repo, so the regex cleanup runs
    once at load time instead of on every request.
    """
    records = []
    with open(times_file, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            records.append({
                "Location": re.sub(r'[^\w\s,:\-]', '', str(row.get("Location") or "")).strip(),
                "Time": re.sub(r'[^\w\s,:;\-]', '', str(row.get("Opening Hours") or "")).strip(),
            })
    return records


class Retriever:
    def __init__(self, pdf_name, times_name=None):
        """
        Initialize the retriever.

        Args:
            pdf_name (str): Name of the PDF file (without extension)
            times_name (str): Name of the times/schedule data file (without extension)
        """
        self.pdf_name = pdf_name
        self.times_name = times_name or TIMES_NAME
        self.embedding_model = EmbeddingModel()
        self.times_dir = get_times_dir()

        self.vector_file, self.metadata_file = vector_store_paths(self.pdf_name)
        self.times_file = os.path.join(self.times_dir, f"{self.times_name}.csv")
        
        self.embeddings = None
        self.metadata = None

    def load_vectors(self):
        """
        Load embeddings and metadata from disk.
        
        Returns:
            bool: Success status
        """
        try:
            if not os.path.exists(self.vector_file) or not os.path.exists(self.metadata_file):
                logger.error(f"Vector files not found for {self.pdf_name}")
                # Keep the "False ⇒ unloaded" contract — stale in-memory
                # data must not keep answering once the files are gone.
                self.embeddings = None
                self.metadata = None
                return False
            
            logger.info(f"Loading vectors from {self.vector_file}")
            # NpzFile loads lazily and holds a file handle — use a context
            # manager so the arrays are materialized and the handle closed
            with np.load(self.vector_file) as npz:
                self.embeddings = npz["embeddings"]
                # Legacy stores carry no generation entry
                vectors_generation = (
                    npz["generation"].item() if "generation" in npz.files else None
                )

            logger.info(f"Loading metadata from {self.metadata_file}")
            with open(self.metadata_file, 'r') as f:
                metadata_payload = json.load(f)

            # New stores wrap the chunk list with the generation stamp
            # shared with the .npz; legacy stores are a bare chunk list.
            if isinstance(metadata_payload, dict):
                metadata_generation = metadata_payload.get("generation")
                self.metadata = metadata_payload.get("chunks", [])
            else:
                metadata_generation = None
                self.metadata = metadata_payload

            # Each file is replaced atomically but the pair isn't — a
            # reader mid-reindex could otherwise pair new vectors with old
            # metadata and silently align chunks with the wrong embeddings.
            # Mismatched generations (including one-sided legacy/new) fail
            # the load; two legacy files (both None) still pass.
            if vectors_generation != metadata_generation:
                raise ValueError(
                    f"vector store generation mismatch for {self.pdf_name}: "
                    f"vectors={vectors_generation} metadata={metadata_generation}"
                )

            # Verify data consistency
            if len(self.metadata) != self.embeddings.shape[0]:
                logger.warning(f"Metadata length ({len(self.metadata)}) doesn't match embeddings count ({self.embeddings.shape[0]})")
            
            logger.info(f"Loaded {len(self.metadata)} chunks with embeddings shape {self.embeddings.shape}")
            return True
        except Exception as e:
            logger.error(f"Error loading vectors: {str(e)}")
            logger.error(traceback.format_exc())
            # A partially loaded pair (e.g. vectors read, then a
            # generation-mismatch raise) must not stay reachable — a
            # later search would skip the load and score chunks against
            # the wrong embeddings. Failure means "unloaded".
            self.embeddings = None
            self.metadata = None
            return False
    
    def search(self, query, top_k=10, score_thresh=0.2, deadline=None):
        """
        Search for relevant chunks based on the query.

        Args:
            query (str): Query text
            top_k (int): Number of top results to retrieve
            score_thresh (float): Minimum similarity score threshold
            deadline: Optional time.monotonic() deadline — forwarded into
                the query embedding's retry loop

        Returns:
            list: List of relevant chunks with metadata and scores —
                empty when the index loaded fine but no chunk cleared
                score_thresh (a legitimate "no relevant chunks" the
                generator intentionally answers around)

        Raises:
            RetrievalError: The vector store can't be loaded or the query
                embedding can't be generated — retrieval genuinely
                failed, not "no relevant chunks".
            DeadlineExceeded: The caller's time budget blew out mid-search
                (propagates unchanged — it's cancellation, not failure).
        """
        try:
            # argsort(scores)[-0:] is the whole array — a non-positive
            # top_k must short-circuit instead of returning every chunk.
            if top_k <= 0:
                return []

            if self.embeddings is None or self.metadata is None:
                if not self.load_vectors():
                    # Unindexed documents are already 404'd upstream by
                    # _document_is_indexed — reaching this point with an
                    # unloadable store means corrupt/half-written files
                    # or a generation mismatch: a broken index, not a
                    # legitimate empty result.
                    raise RetrievalError(
                        f"vector store for '{self.pdf_name}' could not be loaded")

            # Snapshot to locals — a concurrent invalidation (the indexing
            # path clears self.embeddings/self.metadata) must not turn them
            # into None between the check above and np.dot below.
            emb, meta = self.embeddings, self.metadata
            if emb is None or meta is None:
                raise RetrievalError(
                    f"vector store for '{self.pdf_name}' unloaded mid-search")

            # Ensure top_k is not larger than available data
            top_k = min(top_k, len(meta))

            # Generate query embedding
            query_embedding = self.embedding_model.get_query_embedding(
                query, deadline=deadline)
            if query_embedding is None:
                # The embedding API failed — answering from the resulting
                # empty context would be silently ungrounded, so this is
                # an error, not "no relevant chunks".
                raise RetrievalError("query embedding could not be generated")

            # Calculate similarity scores
            similarity_scores = np.dot(emb, query_embedding)

            # Get top k indices — argpartition selects the k candidates in
            # O(n), then only those k are sorted; the result is the same
            # descending-score order as a full argsort. k is clamped to the
            # score count for the (warned) case where the embedding count
            # is smaller than the metadata length; k == n skips the
            # partition entirely (also covers an empty score array).
            n = similarity_scores.shape[0]
            k = min(top_k, n)
            if k == n:
                top_indices = np.arange(n)
            else:
                top_indices = np.argpartition(similarity_scores, n - k)[n - k:]
            top_indices = top_indices[np.argsort(similarity_scores[top_indices])[::-1]]
            
            # Get top k chunks with scores
            results = []
            for i, idx in enumerate(top_indices):
                idx_int = int(idx)
                if idx_int >= len(meta):
                    logger.warning(f"Index {idx_int} out of bounds for metadata of length {len(meta)}")
                    continue

                chunk = meta[idx_int]
                score = float(similarity_scores[idx])
                if score < score_thresh:
                    continue
                
                logger.info(f"Result {i+1}: Page {chunk.get('page_num', 'N/A')} with score {score:.4f}")
                
                results.append({
                    "chunk": chunk,
                    "score": score
                })
            
            logger.info(f"Found {len(results)} relevant chunks for query: '{query}'")
            return results

        except DeadlineExceeded:
            # Cancellation, not a search failure — let it reach the 504
            # handler instead of collapsing to an empty result set.
            raise
        except RetrievalError:
            # Already labelled a retrieval failure — don't re-wrap.
            raise
        except Exception as e:
            logger.error(f"Error searching: {str(e)}")
            logger.error(traceback.format_exc())
            raise RetrievalError(
                f"retrieval failed for '{self.pdf_name}': {e}") from e

    def getTimes(self, city=None):
        """
        Get opening hours and location data for Egyptian monuments.

        Args:
            city (str, optional): City name to filter locations

        Returns:
            list: List of dictionaries with location and opening hours
        """
        try:
            if not os.path.exists(self.times_file):
                logger.error(f"Times file not found: {self.times_file}")
                return []

            # Module-level cache — the CSV is static data, so it is parsed
            # AND regex-cleaned once per path instead of on every request
            results = []
            for row in _load_times_records(self.times_file):
                location = row["Location"]

                # Filter by city
                if city and city.lower() not in location.lower():
                    continue

                results.append({
                    "Location": location,
                    "Time": row["Time"],
                    "City": city if city else self._extract_city(location)
                })

            logger.info(f"Found {len(results)} timing entries for city: {city}")
            return results

        except Exception as e:
            logger.error(f"Error retrieving times data: {str(e)}")
            logger.error(traceback.format_exc())
            return []

    def _extract_city(self, location):
        """
        Helper method to extract city from location string.

        Args:
            location (str): Location text

        Returns:
            str: Extracted city name or empty string
        """
        major_cities = ["cairo", "alexandria", "luxor", "aswan", "giza", "hurghada", "sharm el-sheikh"]
        location_lower = location.lower()
        for city in major_cities:
            if city in location_lower:
                return city
        return ""

def main():
    if len(sys.argv) < 3:
        print("Usage: python retriever.py <pdf_name> <query>")
        sys.exit(1)
    
    pdf_name = sys.argv[1]
    query = sys.argv[2]
    
    retriever = Retriever(pdf_name)
    results = retriever.search(query)
    
    if results:
        print(f"Found {len(results)} results:")
        for i, result in enumerate(results):
            print(f"\nResult {i+1} (Score: {result['score']:.4f}):")
            print(f"Page: {result['chunk'].get('page_num', 'N/A')}")
            print(f"Text: {result['chunk']['text'][:200]}...")
    else:
        print("No results found.")

if __name__ == "__main__":
    main()