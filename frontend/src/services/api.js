import axios from "axios";

const API_URL = "http://localhost:3001/api"; // Adjust if needed

// Create axios instance with default config
const axiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add request interceptor to include auth token
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("authToken");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Helper function to extract main topic from conversation history
const extractTopicFromHistory = (conversationHistory) => {
  if (!conversationHistory || conversationHistory.length === 0) {
    return null;
  }

  // Look for key topics in the conversation history
  const topics = [
    'alexandria', 'pyramids', 'giza', 'sphinx', 'temple', 'pharaoh', 'cleopatra',
    'valley of the kings', 'karnak', 'luxor', 'abu simbel', 'philae', 'saqqara',
    'pompey', 'catacombs', 'roman', 'greco', 'egyptian', 'ancient egypt'
  ];

  // Search through all messages in history
  for (const message of conversationHistory) {
    const content = message.content.toLowerCase();
    
    // Find the most specific topic mentioned
    for (const topic of topics) {
      if (content.includes(topic)) {
        return topic;
      }
    }
    
    // Look for specific structures or places
    const specificMatches = content.match(/\b(great pyramid|sphinx|temple of|valley of|pharaoh|king|queen)\b/gi);
    if (specificMatches) {
      return specificMatches[0].toLowerCase();
    }
  }

  return null;
};

const api = {
  // Set auth token for subsequent requests
  setAuthToken: (token) => {
    if (token) {
      localStorage.setItem("authToken", token);
    } else {
      localStorage.removeItem("authToken");
    }
  },

  // Add this in api.js
  login: async (data) => {
    try {
      const response = await axiosInstance.post(`/auth/login`, data);
      
      // Store the authentication token if it's in the response
      if (response.data && response.data.token) {
        localStorage.setItem("authToken", response.data.token);
        console.log("Authentication token stored successfully");
      } else if (response.data && response.data.accessToken) {
        localStorage.setItem("authToken", response.data.accessToken);
        console.log("Authentication token stored successfully");
      } else {
        console.log("No token found in login response:", response.data);
      }
      
      return response.data;
    } catch (error) {
      console.error("Error during login:", error);
      throw error;
    }
  },

  signup: async (data) => {
    try {
      const response = await axiosInstance.post(`/auth/signup`, data);
      return response.data;
    } catch (error) {
      console.error("Error during signup:", error);
      throw error;
    }
  },

  logout: () => {
    // Clear the authentication token and all related data
    localStorage.removeItem("authToken");
    localStorage.removeItem("currentUserId");
    localStorage.removeItem("globalConversationLoaded");
    localStorage.removeItem("globalCurrentUserId");
    
    // Clear all conversation-related keys
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('conversationId_') || key.startsWith('global'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    console.log("All authentication and conversation data cleared");
  },

  isAuthenticated: () => {
    const token = localStorage.getItem("authToken");
    return !!token;
  },

  getAuthToken: () => {
    return localStorage.getItem("authToken");
  },

  // Conversation management
  getConversations: async () => {
    try {
      const response = await axiosInstance.get(`/chat/conversations`);
      return response.data;
    } catch (error) {
      console.error("Error fetching conversations:", error);
      throw error;
    }
  },

  getConversation: async (conversationId) => {
    try {
      const response = await axiosInstance.get(`/chat/conversations/${conversationId}`);
      return response.data;
    } catch (error) {
      console.error("Error fetching conversation:", error);
      throw error;
    }
  },

  createConversation: async (data) => {
    try {
      const response = await axiosInstance.post(`/chat/conversations`, data);
      return response.data;
    } catch (error) {
      console.error("Error creating conversation:", error);
      throw error;
    }
  },

  addMessageToConversation: async (conversationId, messageData) => {
    try {
      const response = await axiosInstance.post(`/chat/conversations/${conversationId}/messages`, messageData);
      return response.data;
    } catch (error) {
      console.error("Error adding message to conversation:", error);
      throw error;
    }
  },

  // Upload PDF documents (without indexing)
  uploadDocument: async (file) => {
    const formData = new FormData();
    formData.append("pdf", file);

    try {
      const response = await axiosInstance.post(`/upload`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      return response.data;
    } catch (error) {
      console.error("Error uploading document:", error);
      throw error;
    }
  },

  // Index an uploaded document separately
  indexDocument: async (filename) => {
    try {
      const response = await axiosInstance.post(`/index`, { filename });
      return response.data;
    } catch (error) {
      console.error("Error indexing document:", error);
      throw error;
    }
  },

  getIndexingStatus: async () => {
    try {
      const response = await axiosInstance.get(`/indexing-status`);
      return response.data;
    } catch (error) {
      console.error("Error getting indexing status:", error);
      throw error;
    }
  },

  // Query the RAG system
  askQuestion: async (questionOrRequest, useConversationFeatures = false) => {
  try {
    let requestData;
    let endpoint = "/query";

    if (typeof questionOrRequest === "string") {
      requestData = { query: questionOrRequest };
    } else {
      requestData = questionOrRequest;

      if (questionOrRequest.conversationId && useConversationFeatures) {
        endpoint = `/chat/conversations/${questionOrRequest.conversationId}/messages`;
        requestData = {
          role: "user",
          content: questionOrRequest.query
        };

        console.log("Formatted conversation history for API:", questionOrRequest.conversationHistory);
        console.log("Request data being sent:", requestData);
      }
    }

    console.log("Making request to API with data:", requestData);

    const response = await axiosInstance.post(endpoint, requestData);
    console.log("Raw axios response:", response);

    // ✅ Case 1: If AI response is included in the same response
    if (response.data && response.data.answer) {
      return response.data;
    }

    // ✅ Case 2: If response is user message only (no AI reply), call /query once
    if (endpoint !== "/query" && response.data?.role === "user") {
      const queryData = {
        query: questionOrRequest.query,
        conversationId: questionOrRequest.conversationId
      };

      console.log("Fetching AI response using /query with conversationId:", queryData);
      const aiResponse = await axiosInstance.post("/query", queryData);
      return aiResponse.data;
    }

    // Fallback: Parse raw JSON strings if needed
    if (
      typeof response.data === "string" &&
      (response.data.startsWith("{") || response.data.startsWith("["))
    ) {
      try {
        return JSON.parse(response.data);
      } catch (e) {
        console.error("Failed to parse response data as JSON:", e);
        return response.data;
      }
    }

    return response.data;

  } catch (error) {
    console.error("Error querying RAG system:", error);
    throw error;
  }
},


  // Get list of documents
  getDocuments: async () => {
    try {
      const response = await axiosInstance.get(`/documents`);
      return response.data;
    } catch (error) {
      console.error("Error fetching documents:", error);
      throw error;
    }
  },

  // Save chat message to database
  saveChatMessage: async (messageData) => {
    try {
      const response = await axiosInstance.post(`/chat/messages`, messageData);
      return response.data;
    } catch (error) {
      // Silently ignore errors - chat should continue working even if saving fails
      console.log("Chat message saving not available (endpoint may not exist yet)");
      return null;
    }
  },

  // Get chat history for a user
  getChatHistory: async (userId) => {
    try {
      const response = await axiosInstance.get(`/chat/messages?userId=${userId}`);
      return response.data;
    } catch (error) {
      // Silently ignore errors - return empty array so chat continues working
      console.log("Chat history not available (endpoint may not exist yet)");
      return [];
    }
  },
};

export default api;