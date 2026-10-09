import os
import sys
import logging
import json
import argparse
from pathlib import Path
from typing import List, Dict

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.llm import LLMModel
from rag.retriever import Retriever
from rag.utils import get_data_dir

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class Generator:
    def __init__(self, pdf_name=None, times_name=None):
        """
        Initialize the generator.
        
        Args:
            pdf_name (str): Name of the PDF file (without extension)
            times_name (str): Name of the times/schedule data file (without extension)
        """
        self.pdf_name = pdf_name or "egyptian_history"
        self.times_name = times_name or "monument_data"
        self.llm = LLMModel()
        self.retriever = Retriever(self.pdf_name, self.times_name)
    
    def classify_intent(self, query):
        """
        Classify the user query as conversational, information-seeking, or schedule-seeking.
        
        Args:
            query (str): User query
            
        Returns:
            str: "conversational", "information-seeking", or "schedule-seeking".
        """
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
        
        # Get classification from model
        response = self.llm.generate(classification_prompt, max_tokens=20)
        
        # Normalize response
        response = response.lower().strip()
        
        # Extract category
        if "conversational" in response:
            logger.info(f"Query classified as conversational: {query}")
            return "conversational"
        elif "schedule-seeking" in response:
            logger.info(f"Query classified as schedule-seeking: {query}")
            return "schedule-seeking"
        else:
            logger.info(f"Query classified as information-seeking: {query}")
            return "information-seeking"
    
    def get_schedule_parameters(self, query):
        """
        Extract filter parameters from schedule-seeking query.
        """
        parameter_prompt = f"""
        Extract the following parameters from the user's query about visiting Egyptian monuments or locations:
        
        1. City: The Egyptian city mentioned in the query (e.g., Cairo, Alexandria, Luxor, Aswan, Giza). If the extracted city is not in Egypt, respond with not_in_egypt for city name.
        2. Day: The day of the week mentioned (e.g., Monday, Tuesday, etc.)

        Instructions:
        1.If the extracted city is not in Egypt, respond with not_in_egypt for city name.
        2.If a city name is not found in the query, repsond with missing_city for city name.

        
        User query: "{query}"
        
        Format your response EXACTLY as follows with NO additional text:
        city=<extracted city>;day=<extracted day>
        """
        
        response = self.llm.generate(parameter_prompt, max_tokens=50).strip()
        
        # Parse response
        try:
            params = {}
            for pair in response.split(";"):
                if "=" in pair:
                    key, value = pair.split("=", 1)
                    params[key.strip().lower()] = value.strip().lower()
            
            # Validate required parameters
            if "city" not in params or not params["city"]:
                return {"error": "missing_city"}
            if "day" not in params or not params["day"]:
                params["day"] = "friday"  # Default to friday(weekend) if day is missing
            
            if params["city"] == "not_in_egypt":
                return{"error": "not_in_egypt"}
            if params["city"] == "missing_city":
                return{"error": "missing_city"}
            
            logger.info(f"Extracted parameters: {params}")
            return params
        except Exception as e:
            logger.error(f"Error parsing parameters: {str(e)}")
            return {"error": "invalid_format"}
    
    def generate_schedule_response(self, query, max_tokens= 1024, extracted_parameters= {"error": "invalid_format"}, chat_history_str=""):
        """
        Generate a schedule response for Egyptian monument visits.
        
        Args:
            query (str): User query
            
        Returns:
            dict: Response with schedule information or error
        """
        try:
            # Step 1: Extract parameters from query
            parameters = extracted_parameters
            
            # Step 2: Handle parameter errors
            if "error" in parameters:
                if parameters["error"] == "missing_city":
                    return {
                        "answer": "I need to know which Egyptian city you want to visit. Could you specify the city?",
                        "query_type": "schedule-seeking",
                    }
                elif parameters["error"] == "invalid_format":
                    return {
                        "answer": "I couldn't understand your request. Please specify which Egyptian city and day you want to visit.",
                        "query_type": "schedule-seeking",
                    }
                elif parameters["error"] == "not_in_egypt":
                    return {
                        "answer": "I apologize. I am only able to create schedules for cities in the country of Egypt.",
                        "query_type": "schedule-seeking",
                    }
        
            # Step 3: Get relevant location data from the retriever
            results = self.retriever.getTimes(query, parameters["city"])
            
            #logger.info(f"Retrieved times data: {results}")
            
            if not results or len(results) == 0:
                return {
                    "answer": f"I don't have information about monuments or locations in {parameters['city']}. Could you try another Egyptian city?",
                    "query_type": "schedule-seeking"
                }
            
            # Step 4: Create an optimized schedule using extracted parameters and location data
            schedule_prompt = f"""
            Create a detailed one-day tour schedule for visiting monuments in {parameters['city']} on {parameters['day']}.

            {'' if not chat_history_str else f'''=== PREVIOUS CONVERSATION ==
            {chat_history_str}'''}

            Available locations and their opening hours:
            {json.dumps([{
                "location": item["Location"],
                "hours": item["Time"]
            } for item in results], indent=2)}

            Guidelines:
            1. Start the day at 8:00 AM and end by 6:00 PM.
            2. Include 3-5 major attractions based on proximity and importance.
            3. Allocate realistic visiting times for each location (1-2 hours).
            4. Include travel time between locations (15-30 minutes).
            5. Add a lunch break around noon (1 hour).
            6. Ensure the schedule respects the opening hours of each location.
            7. Use a friendly and conversational tone, as if you're a tour guide.
            8. Limit your response to a max token value of {max_tokens}
            9. Don't utilize special characters in your response. Respond as if you are chatting normally.

            Format your response as a complete schedule with times, locations, and brief descriptions. Example:

            8:00 AM - 9:30 AM: Visit Karnak Temple. Explore the largest religious structure ever built, with its towering columns and intricate carvings.
            9:30 AM - 10:00 AM: Travel to Luxor Temple.
            10:00 AM - 11:30 AM: Visit Luxor Temple. Admire its elegant architecture and the Avenue of Sphinxes.

            User Query: {query}
            """
            
            # Generate the schedule
            #logger.info(f"Schedule prompt sent to LLM:\n{schedule_prompt}")
            schedule_response = self.llm.generate(schedule_prompt, max_tokens= max_tokens)
            logger.info(f"Schedule response from LLM:\n{schedule_response}")
            
            if not schedule_response or not schedule_response.strip():
                return {
                    "answer": "I couldn't generate a schedule at this time. Please try again later.",
                    "query_type": "schedule-seeking"
                }
            
            return {
                "answer": schedule_response,
                "city": parameters["city"],
                "day": parameters["day"],
                "query_type": "schedule-seeking"
            }
            
        except Exception as e:
            logger.error(f"Error generating schedule: {str(e)}", exc_info=True)
            return {
                "answer": f"An error occurred while creating the schedule: {str(e)}",
                "query_type": "schedule-seeking"
            }

    def generate_conversational_response(self, query, conversation_history=None):
        """
        Generate a conversational response without document retrieval.
        
        Args:
            query (str): User query
            conversation_history (list): Previous conversation exchanges
            
        Returns:
            dict: Response with answer
        """
        try:
            # Format conversation history
            formatted_history = ""
            if conversation_history:
                if not isinstance(conversation_history, list):
                    raise ValueError("Conversation history must be a list of dictionaries.")
                
                formatted_history = "Previous conversation:\n"
                for exchange in conversation_history:
                    if not isinstance(exchange, dict):
                        raise ValueError("Each conversation history item must be a dictionary.")
                    
                    role = exchange.get("role", "unknown").lower()
                    content = exchange.get("content", "")
                    if role == "user":
                        formatted_history += f"Human: {content}\n"
                    elif role == "assistant":
                        formatted_history += f"Assistant: {content}\n"
                    else:
                        # Unknown role, just add content
                        formatted_history += f"{content}\n"
                formatted_history += "\n"
            
            # Create the prompt
            prompt = f"""You are a friendly Egyptian history expert assistant. Respond conversationally to the following message.
            Do not mention documents or searching for information, just respond naturally as in a conversation.

            {formatted_history}
            Human: {query}

            Assistant:"""
            
            # Generate response
            answer = self.llm.generate(prompt)
            
            return {
                "answer": answer,
                "sources": [],
                "is_conversational": True
            }
        except Exception as e:
            logger.error(f"Error generating conversational response: {str(e)}", exc_info=True)
            return {
                "answer": f"An error occurred: {str(e)}",
                "sources": [],
                "is_conversational": True
            }
    
    def create_enhanced_prompt(self, query, retrieved_documents, chat_history_str=""):
        """
        Create an enhanced prompt template that includes chat history and retrieved documents.
        """
        # System instructions
        system_instructions = """You are an expert on Egyptian history. Provide accurate, detailed, and engaging answers using the provided documents and your own knowledge as needed. Your response should be informative, vivid, and suitable for a curious audience. Do not mention sources or differentiate between document content and your own knowledge. Respond in the same language as the user's query."""

        # Format document context
        document_context = ""
        for i, doc in enumerate(retrieved_documents, 1):
            page_num = doc.get('metadata', {}).get('page', 'Unknown')
            text = doc.get('text', '')
            document_context += f"[Document {i} - Page {page_num}]: {text}\n\n"

        # Construct full prompt with clear separators
        prompt = f"""
{system_instructions}

{'' if not chat_history_str else f'''=== PREVIOUS CONVERSATION ===
{chat_history_str}

'''}=== RETRIEVED CONTEXT ===
{document_context}

=== CURRENT QUERY ===
{query}

=== INSTRUCTIONS ===
1. Use the retrieved context and your own knowledge to provide a comprehensive, engaging answer.
2. Do not mention sources, citations, or differentiate between document content and your own knowledge.
3. Answer in a conversational, engaging tone suitable for a curious audience.
4. If the information to answer the query is not available, say so clearly.
5. Respond in the same language as the user's query by default. If the user specifies a specific language for response, follow their instruction as long as you are capable of using that language. 

Respond with a comprehensive answer:
"""

        return prompt

    
    def generate_information_response(self, query, top_k=10):
        """
        Generate a response to the query using RAG.
        
        Args:
            query (str): User query
            top_k (int): Number of top results to retrieve
            
        Returns:
            dict: Response with answer and sources
        """
        try:
            # Retrieve relevant chunks
            results = self.retriever.search(query, top_k=top_k)
            
            if not results:
                return {
                    "answer": "I couldn't find any relevant information about this in the Egyptian history documents.",
                    "sources": [],
                    "is_conversational": False
                }
            
            # Generate prompt
            prompt = self.generate_prompt(query, results)
            
            # Generate response
            answer = self.llm.generate(prompt)
            
            # Format sources
            sources = []
            for item in results:
                chunk = item["chunk"]
                sources.append({
                    "page": chunk["page_num"],
                    "text": chunk["text"][:200] + "..." if len(chunk["text"]) > 200 else chunk["text"]
                })
            
            return {
                "answer": answer,
                "sources": sources,
                "is_conversational": False
            }
        except Exception as e:
            logger.error(f"Error generating response: {str(e)}")
            return {
                "answer": f"An error occurred: {str(e)}",
                "sources": [],
                "is_conversational": False
            }
            
    def generate_response(self, query, top_k=10, chat_history=None):
        """
        Generate a response using the RAG pipeline with chat history and query enhancement.
        
        Args:
            query: User query text
            top_k: Number of documents to retrieve
            chat_history: Optional chat history from MongoDB
        
        Returns:
            Generated response with sources
        """
        try:
            # Classify the query intent
            intent = self.classify_intent(query)
            #logger.info(f"Extracted History: {chat_history}")
            
            # Process chat history if provided
            formatted_history = ""
            selected_history = []
            if chat_history:
                if not isinstance(chat_history, list):
                    logger.warning("Invalid chat history format. Expected a list of dictionaries.")
                    chat_history = []  # Default to an empty list
                
                # Apply window selection to get most relevant messages
                selected_history = self.window_selection(chat_history)
                # Format the selected history into a string
                formatted_history = self.history_handler(selected_history)
                logger.info(f"Processed {len(selected_history)} messages from chat history")
            
            # Generate appropriate response based on intent
            if intent == "schedule-seeking":
                original_query= query
                params= self.get_schedule_parameters(original_query)
                if chat_history and len(selected_history) > 0:
                    query = self.enhance_query_with_context(original_query, selected_history, self.llm)
                    logger.info(f"Enhanced query: '{original_query}' → '{query}'")

                return self.generate_schedule_response(query, extracted_parameters = params, chat_history_str = formatted_history)
            elif intent == "conversational":
                return self.generate_conversational_response(query, selected_history)
            else:
                # Enhance query with context if we have chat history
                original_query = query
                if chat_history and len(selected_history) > 0:
                    query = self.enhance_query_with_context(original_query, selected_history, self.llm)
                    logger.info(f"Enhanced query: '{original_query}' → '{query}'")
                
                # Use enhanced query for retrieval
                search_results = self.retriever.search(query, top_k=top_k)
                
                # Convert search results to expected format
                retrieved_documents = []
                for result in search_results:
                    chunk = result["chunk"]
                    retrieved_documents.append({
                        "text": chunk.get("text", ""),
                        "metadata": {
                            "page": chunk.get("page_num", "Unknown"),
                            "source": self.retriever.pdf_name
                        }
                    })
                
                # Create enhanced prompt with chat history and retrieved documents
                enhanced_prompt = self.create_enhanced_prompt(
                    query=query,
                    retrieved_documents=retrieved_documents,
                    chat_history_str=formatted_history
                )
                
                # Generate response using the enhanced prompt
                answer = self.llm.generate(enhanced_prompt)
                
                # Extract sources from retrieved documents for citation
                sources = [
                    {
                        "page": doc["metadata"]["page"],
                        "text": doc["text"][:100] + "..." if len(doc["text"]) > 100 else doc["text"]
                    }
                    for doc in retrieved_documents
                ]
                
                return {
                    "answer": answer,
                    "sources": sources,
                    "is_conversational": False,
                    "original_query": original_query if query != original_query else None,
                    "enhanced_query": query if query != original_query else None
                }
        except Exception as e:
            logger.error(f"Error generating response: {str(e)}", exc_info=True)
            return {
                "answer": f"An error occurred: {str(e)}",
                "sources": [],
                "is_conversational": False
            }

    def enhance_query_with_context(self, query, chat_history, llm):
        """
        Enhance queries with contextual information from chat history.
        
        Args:
            query (str): Current user query
            chat_history (list): List of previous messages with role and content
            llm: LLM instance for query enhancement
            
        Returns:
            str: Enhanced query with contextual information
        """
        # Check if we have enough history to provide context
        if not chat_history or len(chat_history) < 2:
            return query
        
        # Check if the query likely needs enhancement (contains pronouns or references)
        ambiguous_terms = ['it', 'this', 'that', 'they', 'them', 'he', 'she', 'his', 'her', 'their', 'these', 'those']
        short_query_words = len(query.split()) < 7
        has_ambiguous_terms = any(term in query.lower().split() for term in ambiguous_terms)
        
        needs_enhancement = short_query_words or has_ambiguous_terms
        
        if not needs_enhancement:
            return query
            
        # Format conversation history
        formatted_history = ""
        # Only use last 3 turns of conversation (3 pairs of user/assistant)
        recent_history = chat_history[-6:] if len(chat_history) > 6 else chat_history
        
        for msg in recent_history:
            role = msg['role']
            content = msg['content']
            formatted_history += f"{role.capitalize()}: {content}\n"
        
        # Create prompt for query enhancement
        enhancement_prompt = f"""
    You are a query enhancement system that rewrites ambiguous follow-up questions into self-contained queries.
    The user is having a conversation about Egyptian history. Below is the conversation history:

    {formatted_history}

    User's latest query: "{query}"

    This query may contain references to entities mentioned in previous turns. 
    Your task is to rewrite this query into a self-contained question that explicitly includes all relevant context.
    Don't add any explanations, just return the rewritten query.

    Examples:
    - "When did he rule?" → "When did Pharaoh Khufu, builder of the Great Pyramid of Giza, rule Egypt?"
    - "How tall was it?" → "How tall was the Great Pyramid of Giza when initially built?"
    - "Tell me more about them" → "Tell me more about the pyramids of Giza mentioned earlier"

    Rewritten query:
    """
        
        # Get enhanced query from LLM
        enhanced_query = llm.generate(enhancement_prompt).strip()
        
        # Don't let enhanced queries get too long
        if len(enhanced_query) > 200:
            enhanced_query = enhanced_query[:200]
            
        return enhanced_query


    def history_handler(self,chat_history: List[Dict], max_turns: int = 3) -> str:
        """
        Convert JSON chat history from MongoDB into a formatted string representation.
        Format each message as 'User: {content}' or 'Assistant: {content}'.
        Apply window selection to include only the last max_turns pairs (user+assistant).

        Args:
            chat_history (List[Dict]): List of messages with 'role' and 'content'.
            max_turns (int): Number of recent conversation turns to include.

        Returns:
            str: Formatted chat history string.
        """
        if not chat_history:
            return ""
            
        # Filter to last max_turns * 2 messages (each turn has user and assistant)
        relevant_messages = chat_history[-max_turns*2:]

        formatted_messages = []
        for msg in relevant_messages:
            role = msg.get('role', '').lower()
            content = msg.get('content', '')
            if role == 'user':
                formatted_messages.append(f"User: {content}")
            elif role == 'assistant':
                formatted_messages.append(f"Assistant: {content}")
            else:
                # Unknown role, just add content
                formatted_messages.append(content)

        # Join messages with newlines
        return '\n'.join(formatted_messages)
    
    def window_selection(self,chat_history, max_turns=3, max_tokens=10000):
        """
        Select the most relevant conversation history using a sliding window approach.
        
        Args:
            chat_history (list): List of messages with 'role' and 'content' keys
            max_turns (int): Maximum number of conversation turns to include
            max_tokens (int): Maximum total tokens allowed in selected history
            
        Returns:
            list: Selected and possibly truncated messages in chronological order
        """
        if not chat_history:
            return []
            
        # Try to use tiktoken for accurate token counting if available
        try:
            import tiktoken
            encoding = tiktoken.get_encoding("cl100k_base")
            
            def count_tokens(text):
                return len(encoding.encode(text))
        except ImportError:
            # Fallback to word count approximation if tiktoken not available
            def count_tokens(text):
                return len(text.split())
        
        selected_messages = []
        total_tokens = 0
        turns_collected = 0
        
        # Process messages from newest to oldest
        for msg in reversed(chat_history):
            # Get message content and count tokens
            content = msg.get('content', '')
            tokens = count_tokens(content)
            
            # Handle long single messages by truncating
            if tokens > max_tokens // 2:  # Allow at most half of total tokens for one message
                if "tiktoken" in locals():
                    # Accurate truncation with tiktoken
                    encoded = encoding.encode(content)
                    truncated_encoded = encoded[:max_tokens // 2]
                    truncated_content = encoding.decode(truncated_encoded)
                else:
                    # Fallback word-based truncation
                    words = content.split()
                    truncated_content = ' '.join(words[:max_tokens // 2]) + "... [truncated]"
                
                msg = msg.copy()  # Create a copy to avoid modifying original
                msg['content'] = truncated_content
                tokens = count_tokens(truncated_content)
            
            # Check if adding this message would exceed token limit
            if total_tokens + tokens > max_tokens:
                break
            
            # Add message to selected list
            selected_messages.append(msg)
            total_tokens += tokens
            
            # Count turns (user messages)
            if msg.get('role', '').lower() == 'user':
                turns_collected += 1
                # Stop if we've collected enough turns
                if turns_collected >= max_turns:
                    break
        
        # Reverse back to chronological order
        selected_messages.reverse()
        return selected_messages

def main():
    parser = argparse.ArgumentParser(description="Generate a response to a query using RAG")
    parser.add_argument("query", help="User query")
    parser.add_argument("--pdf-name", help="Name of the PDF file (without extension)")
    parser.add_argument("--times-name", help="Name of the file containing the time database (without extension)")
    parser.add_argument("--top-k", type=int, default=5, help="Number of top results to retrieve")
    parser.add_argument("--conversation-history", help="JSON string of conversation history")
    
    args = parser.parse_args()
    
    generator = Generator(pdf_name=args.pdf_name, times_name=args.times_name)
    
    # Parse conversation history if provided
    conversation_history = None
    if args.conversation_history:
        try:
            conversation_history = json.loads(args.conversation_history)
        except json.JSONDecodeError:
            logger.error("Failed to parse conversation history JSON")
    
    response = generator.generate_response(
        args.query, 
        conversation_history=conversation_history,
        top_k=args.top_k
    )
    
    print(json.dumps(response))

if __name__ == "__main__":
    main()