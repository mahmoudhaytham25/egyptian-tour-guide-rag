import os
import sys
import logging
import numpy as np

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.llm import LLMModel

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("reranker")

class Reranker:
    def __init__(self):
        """Initialize the reranker."""
        self.llm = LLMModel()
    
    def rerank(self, query, results, top_k=5):
        """
        Rerank the retrieved results using the LLM.
        
        Args:
            query (str): The user query
            results (list): List of retrieved results
            top_k (int): Number of top results to return
            
        Returns:
            list: Reranked results
        """
        if not results or len(results) <= 1:
            return results
        
        try:
            # Format results for reranking
            formatted_results = ""
            for i, result in enumerate(results):
                chunk = result["chunk"]
                formatted_results += f"Document {i+1}:\n{chunk['text']}\n\n"
            
            # Create a reranking prompt
            rerank_prompt = f"""
            I need you to rerank these document chunks based on their relevance to the query.
            
            Query: {query}
            
            Documents:
            {formatted_results}
            
            Please analyze each document's relevance to the query. Consider:
            1. How directly it answers the query
            2. The factual accuracy and completeness
            3. The specificity to the query topic
            
            Return only a comma-separated list of document numbers in order of relevance (most relevant first).
            For example: 3,1,5,2,4
            """
            
            # Get reranking from LLM
            rerank_response = self.llm.generate(rerank_prompt, max_tokens=50).strip()
            logger.info(f"Reranking response: {rerank_response}")
            
            # Parse the reranking response
            try:
                reranked_indices = [int(idx.strip()) - 1 for idx in rerank_response.split(',') if idx.strip().isdigit()]
                
                # Filter valid indices
                reranked_indices = [idx for idx in reranked_indices if 0 <= idx < len(results)]
                
                # Add any missing indices at the end
                all_indices = set(range(len(results)))
                missing_indices = all_indices - set(reranked_indices)
                reranked_indices.extend(missing_indices)
                
                # Limit to top_k
                reranked_indices = reranked_indices[:top_k]
                
                # Reorder results
                reranked_results = [results[idx] for idx in reranked_indices]
                return reranked_results
            except Exception as e:
                logger.error(f"Error parsing reranking response: {str(e)}")
                return results[:top_k]  # Return original top_k results if parsing fails
                
        except Exception as e:
            logger.error(f"Error in reranking: {str(e)}")
            return results[:top_k]  # Return original top_k results if reranking fails
