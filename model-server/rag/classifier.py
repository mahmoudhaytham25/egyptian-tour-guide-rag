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

        This is the single classification implementation used in production —
        Generator.classify_intent delegates here rather than duplicating the
        prompt and parsing logic.

        Args:
            query (str): User query

        Returns:
            dict: {"type": "conversational"|"information-seeking"|"schedule-seeking",
                   "confidence": float}
        """
        try:
            # Create classification prompt
            classification_prompt = f"""
            Task: Classify the user query into exactly ONE category.

            Categories:
            - "conversational": General chat, greetings, small talk, personal questions, opinions
            - "information-seeking": Questions about Egyptian history, facts, or specific knowledge that requires document search
            - "schedule-seeking": Requests for visiting schedules, planning a trip, or itinerary suggestions for Egyptian monuments/locations

            Examples:
            - "Hello, how are you?" → "conversational"
            - "Tell me about Egyptian pyramids" → "information-seeking"
            - "What's a good schedule for visiting Cairo on Sunday?" → "schedule-seeking"
            - "Can you help me plan a trip to Alexandria on Tuesday?" → "schedule-seeking"
            - "When was the Great Pyramid built?" → "information-seeking"

            User query: "{query}"

            Classification (respond with exactly one word - conversational, information-seeking, or schedule-seeking):
            """

            # Get classification from model. max_tokens is intentionally
            # generous — thinking-style models need budget for reasoning
            # tokens even when the final answer is a single word.
            response = self.llm.generate(classification_prompt, max_tokens=1024)

            # Normalize response
            response = response.lower().strip()

            # Extract category
            if "conversational" in response:
                return {"type": "conversational", "confidence": 0.9}
            elif "schedule-seeking" in response:
                return {"type": "schedule-seeking", "confidence": 0.9}
            elif "information-seeking" in response:
                return {"type": "information-seeking", "confidence": 0.9}
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