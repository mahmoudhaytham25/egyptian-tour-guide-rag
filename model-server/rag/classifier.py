import logging
import json
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class IntentClassifier:
    def __init__(self, llm=None):
        if llm is None:
            # Add project root to path
            import os, sys
            sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            try:
                from models.llm import LLMModel
                self.llm = LLMModel()
            except ImportError as e:
                logger.error(f"Failed to import LLMModel: {e}")
                from llm import LLMModel  # Try relative import as fallback
                self.llm = LLMModel()
        else:
            self.llm = llm

    
    def classify(self, query):
        """
        Classify the user query as conversational, information-seeking, or schedule-seeking.
        
        Args:
            query (str): User query
            
        Returns:
            str: "conversational", "information-seeking", or "schedule-seeking"
        """
        try:
            # Create classification prompt
            classification_prompt = f"""
            You are an AI assistant designed to classify user messages into exactly ONE of these categories:
            1. Conversational: Greetings, small talk, personal questions, opinions, etc.
            2. Information-Seeking: Questions requiring document search or specific knowledge about Egyptian history
            3. Schedule-Seeking: Queries requesting a schedule to visit a number of areas in a period of time.
            
            User message: "{query}"
            
            Respond with just the category name: "conversational", "information-seeking", or "schedule-seeking".
            """
            
            # Get classification from model
            response = self.llm.generate(classification_prompt, max_tokens=20)
            
            # Normalize response
            response = response.lower().strip()
            
            # Extract category
            if "conversational" in response:
                return {"type": "conversational", "confidence": 0.9}
            elif "information-seeking" in response:
                return {"type": "information-seeking", "confidence": 0.9}
            elif "schedule-seeking" in response:
                return {"type": "schedule-seeking", "confidence": 0.9}
            else:
                # Default to information-seeking for ambiguous cases
                logger.warning(f"Ambiguous classification: {response}. Defaulting to information-seeking.")
                return {"type": "information-seeking", "confidence": 0.6}
                    
        except Exception as e:
            logger.error(f"Error classifying query: {str(e)}")
            # Default to information-seeking on error
            return {"type": "information-seeking", "confidence": 0.5}

# For testing
if __name__ == "__main__":
    if len(sys.argv) > 1:
        query = sys.argv[1]
        classifier = IntentClassifier()
        result = classifier.classify(query)
        print(json.dumps({"classification": result}))
    else:
        print("Usage: python classifier.py 'your query here'")