import os
import sys
import logging
import functools
import numpy as np
import json
import pandas as pd
import re
import traceback

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.embedding import EmbeddingModel
from rag.utils import get_vector_store_dir, get_times_dir

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("retriever")


@functools.lru_cache(maxsize=8)
def _load_times_records(times_file):
    """Read a monument schedule CSV once per path and pre-clean every row.

    The CSV is static data shipped with the repo, so the regex cleanup runs
    once at load time instead of on every request.
    """
    records = []
    for _, row in pd.read_csv(times_file).iterrows():
        records.append({
            "Location": re.sub(r'[^\w\s,:\-]', '', str(row.get("Location", ""))).strip(),
            "Time": re.sub(r'[^\w\s,:;\-]', '', str(row.get("Opening Hours", ""))).strip(),
        })
    return records


class Retriever:
    def __init__(self, pdf_name, times_name=None, top_k=10):
        """
        Initialize the retriever.
        
        Args:
            pdf_name (str): Name of the PDF file (without extension)
            times_name (str): Name of the times/schedule data file (without extension)
            top_k (int): Number of top results to retrieve
        """
        self.pdf_name = pdf_name
        self.top_k = top_k
        self.times_name = times_name or "monument_data"
        self.embedding_model = EmbeddingModel()
        self.vector_store_dir = get_vector_store_dir()
        self.times_dir = get_times_dir()
        
        self.vector_file = os.path.join(self.vector_store_dir, f"{self.pdf_name}_vectors.npz")
        self.metadata_file = os.path.join(self.vector_store_dir, f"{self.pdf_name}_metadata.json")
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
                return False
            
            logger.info(f"Loading vectors from {self.vector_file}")
            # NpzFile loads lazily and holds a file handle — use a context
            # manager so the arrays are materialized and the handle closed
            with np.load(self.vector_file) as npz:
                self.embeddings = npz["embeddings"]
            
            logger.info(f"Loading metadata from {self.metadata_file}")
            with open(self.metadata_file, 'r') as f:
                self.metadata = json.load(f)
            
            # Verify data consistency
            if len(self.metadata) != self.embeddings.shape[0]:
                logger.warning(f"Metadata length ({len(self.metadata)}) doesn't match embeddings count ({self.embeddings.shape[0]})")
            
            logger.info(f"Loaded {len(self.metadata)} chunks with embeddings shape {self.embeddings.shape}")
            return True
        except Exception as e:
            logger.error(f"Error loading vectors: {str(e)}")
            logger.error(traceback.format_exc())
            return False
    
    def search(self, query, top_k=10, score_thresh=0.2):
        """
        Search for relevant chunks based on the query.
        
        Args:
            query (str): Query text
            top_k (int): Number of top results to retrieve (overrides instance value)
            score_thresh (float): Minimum similarity score threshold
            
        Returns:
            list: List of relevant chunks with metadata and scores
        """
        try:
            if self.embeddings is None or self.metadata is None:
                if not self.load_vectors():
                    return []

            # Snapshot to locals — a concurrent invalidation (the indexing
            # path clears self.embeddings/self.metadata) must not turn them
            # into None between the check above and np.dot below.
            emb, meta = self.embeddings, self.metadata
            if emb is None or meta is None:
                return []

            # Ensure top_k is not larger than available data
            top_k = min(top_k, len(meta))

            # Generate query embedding
            query_embedding = self.embedding_model.get_query_embedding(query)
            if query_embedding is None:
                logger.error("Failed to generate query embedding")
                return []

            # Calculate similarity scores
            similarity_scores = np.dot(emb, query_embedding)
            
            # Get top k indices
            top_indices = np.argsort(similarity_scores)[-top_k:][::-1]
            
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
            
        except Exception as e:
            logger.error(f"Error searching: {str(e)}")
            logger.error(traceback.format_exc())
            return []

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