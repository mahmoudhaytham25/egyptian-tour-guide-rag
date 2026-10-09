import os
import sys
import time
import logging
import argparse
from tqdm import tqdm
import numpy as np
import json
import uuid
from pathlib import Path

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.embedding import EmbeddingModel
from rag.utils import ensure_directory, get_vector_store_dir, chunk_list

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class PDFIndexer:
    def __init__(self, pdf_path, chunk_size=500, chunk_overlap=100, batch_size=200):
        """
        Initialize the PDF indexer.
        
        Args:
            pdf_path (str): Path to the PDF file
            chunk_size (int): Size of text chunks in characters
            chunk_overlap (int): Overlap between chunks in characters
            batch_size (int): Batch size for processing
        """
        self.pdf_path = pdf_path
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.batch_size = batch_size
        self.embedding_model = EmbeddingModel()
        self.vector_store_dir = get_vector_store_dir()
        
        # Extract filename without extension for storing vectors
        self.pdf_name = os.path.splitext(os.path.basename(pdf_path))[0]
        self.vector_file = os.path.join(self.vector_store_dir, f"{self.pdf_name}_vectors.npz")
        self.metadata_file = os.path.join(self.vector_store_dir, f"{self.pdf_name}_metadata.json")
        
    def load_pdf(self):
        """
        Load and parse the PDF file.
        """
        try:
            logger.info(f"Loading PDF: {self.pdf_path}")
            
            # Try to import PyMuPDF
            try:
                import fitz
            except ImportError:
                logger.info("Installing PyMuPDF...")
                import pip
                pip.main(['install', 'PyMuPDF'])
                import fitz
            
            # Open the PDF
            doc = fitz.open(self.pdf_path)
            total_pages = len(doc)
            logger.info(f"PDF loaded successfully. Total pages: {total_pages}")
            
            # Extract text from each page
            all_text = []
            for page_num in tqdm(range(total_pages), desc="Extracting text"):
                page = doc.load_page(page_num)
                text = page.get_text()
                all_text.append({
                    "page_num": page_num + 1,
                    "text": text
                })
            
            doc.close()
            return all_text
        except Exception as e:
            logger.error(f"Error loading PDF: {str(e)}")
            return None
    
    def split_into_chunks(self, pages):
        """
        Split the extracted text into chunks.
        
        Args:
            pages (list): List of dictionaries containing page number and text
            
        Returns:
            list: List of chunks with metadata
        """
        try:
            logger.info("Splitting text into chunks")
            chunks = []
            
            for page in tqdm(pages, desc="Chunking pages"):
                page_num = page["page_num"]
                text = page["text"]
                
                # Skip empty pages
                if not text.strip():
                    continue
                
                # Split text into chunks
                current_pos = 0
                while current_pos < len(text):
                    # Extract chunk
                    chunk_text = text[current_pos:current_pos + self.chunk_size]
                    
                    # Only add non-empty chunks
                    if chunk_text.strip():
                        chunk_id = str(uuid.uuid4())
                        chunks.append({
                            "id": chunk_id,
                            "text": chunk_text,
                            "page_num": page_num,
                            "position": current_pos
                        })
                    
                    # Move position with overlap
                    current_pos += self.chunk_size - self.chunk_overlap
            
            logger.info(f"Created {len(chunks)} chunks")
            return chunks
        except Exception as e:
            logger.error(f"Error splitting text into chunks: {str(e)}")
            return []
    
    def create_embeddings(self, chunks):
        """
        Create embeddings for the chunks.
        
        Args:
            chunks (list): List of chunks with metadata
            
        Returns:
            tuple: (embeddings array, metadata list)
        """
        try:
            logger.info("Creating embeddings for chunks")
            
            # Extract texts from chunks
            texts = [chunk["text"] for chunk in chunks]
            
            # Process in batches to avoid memory issues
            all_embeddings = []
            
            # Split texts into batches
            text_batches = chunk_list(texts, self.batch_size)
            
            for i, batch in enumerate(text_batches):
                logger.info(f"Processing batch {i+1}/{len(text_batches)}")
                batch_embeddings = self.embedding_model.get_embeddings(batch)
                
                if batch_embeddings is not None:
                    all_embeddings.append(batch_embeddings)
                else:
                    logger.error(f"Failed to generate embeddings for batch {i+1}")
                    return None, None
            
            # Combine all embeddings
            if all_embeddings:
                embeddings = np.vstack(all_embeddings)
                return embeddings, chunks
            else:
                logger.error("No embeddings were generated")
                return None, None
        except Exception as e:
            logger.error(f"Error creating embeddings: {str(e)}")
            return None, None
    
    def save_vectors(self, embeddings, metadata):
        """
        Save embeddings and metadata to disk.
        
        Args:
            embeddings (numpy.ndarray): Array of embeddings
            metadata (list): List of chunk metadata
            
        Returns:
            bool: Success status
        """
        try:
            logger.info(f"Saving vectors to {self.vector_file}")
            np.savez_compressed(self.vector_file, embeddings=embeddings)
            
            logger.info(f"Saving metadata to {self.metadata_file}")
            with open(self.metadata_file, 'w') as f:
                json.dump(metadata, f)
            
            logger.info("Vectors and metadata saved successfully")
            return True
        except Exception as e:
            logger.error(f"Error saving vectors: {str(e)}")
            return False
    
    def index(self):
        """
        Index the PDF file.
        
        Returns:
            bool: Success status
        """
        try:
            start_time = time.time()
            
            # Load PDF
            pages = self.load_pdf()
            if not pages:
                return False
            
            # Split into chunks
            chunks = self.split_into_chunks(pages)
            if not chunks:
                return False
            
            # Create embeddings
            embeddings, metadata = self.create_embeddings(chunks)
            if embeddings is None or metadata is None:
                return False
            
            # Save vectors
            if not self.save_vectors(embeddings, metadata):
                return False
            
            end_time = time.time()
            logger.info(f"Indexing completed in {end_time - start_time:.2f} seconds")
            return True
        except Exception as e:
            logger.error(f"Error indexing PDF: {str(e)}")
            return False

def main():
    parser = argparse.ArgumentParser(description="Index a PDF file for RAG")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("--chunk-size", type=int, default=500, help="Chunk size in characters")
    parser.add_argument("--chunk-overlap", type=int, default=100, help="Chunk overlap in characters")
    parser.add_argument("--batch-size", type=int, default=200, help="Batch size for processing")
    
    args = parser.parse_args()
    
    indexer = PDFIndexer(
        args.pdf_path,
        chunk_size=args.chunk_size,
        chunk_overlap=args.chunk_overlap,
        batch_size=args.batch_size
    )
    
    success = indexer.index()
    
    if success:
        print("progress: 100")
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()