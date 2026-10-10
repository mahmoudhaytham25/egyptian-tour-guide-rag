import axios from "axios";

// Vite inlines VITE_* env vars at build time; fall back to the local default.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const AUTH_TOKEN_KEY = "authToken";

// Clear the token plus every chat-related key this app (and older builds of
// it) may have left behind in localStorage.
const clearAuthData = () => {
  localStorage.removeItem(AUTH_TOKEN_KEY);

  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key &&
      (key.startsWith("conversationId") ||
        key === "currentUserId" ||
        key.startsWith("global"))
    ) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
};

// Decode a JWT payload without verifying the signature — signature checks are
// the backend's job; the client only needs `exp` and the user id.
const decodeTokenPayload = (token) => {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    // base64url segments may be unpadded — atob needs a multiple of 4.
    const base64 =
      parts[1].replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (parts[1].length % 4)) % 4);
    return JSON.parse(atob(base64));
  } catch (e) {
    return null;
  }
};

// Create axios instance with default config. The timeout is generous because
// /query waits on the LLM (the backend itself allows up to ~2 minutes).
const axiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 130000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach the auth token to every request.
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// A 401 means the token is missing, expired, or invalid — drop the session
// and bounce to the login page. (Skipped when already on "/" so a failed
// login attempt doesn't trigger a redirect loop.)
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearAuthData();
      if (window.location.pathname !== "/") {
        window.location.assign("/");
      }
    }
    return Promise.reject(error);
  }
);

const api = {
  // Set auth token for subsequent requests
  setAuthToken: (token) => {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  },

  login: async (data) => {
    const response = await axiosInstance.post(`/auth/login`, data);
    const token = response.data?.token || response.data?.accessToken;
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    }
    return response.data;
  },

  signup: async (data) => {
    const response = await axiosInstance.post(`/auth/signup`, data);
    return response.data;
  },

  logout: () => {
    clearAuthData();
  },

  // Authenticated = a present token whose JWT `exp` is still in the future.
  isAuthenticated: () => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) return false;
    const payload = decodeTokenPayload(token);
    if (!payload) return false;
    // `exp` is seconds since epoch. Tokens without `exp` are treated as valid.
    if (typeof payload.exp === "number") {
      return payload.exp * 1000 > Date.now();
    }
    return true;
  },

  // Best-effort user id pulled from the JWT claims, or null when absent.
  getUserId: () => {
    const payload = decodeTokenPayload(localStorage.getItem(AUTH_TOKEN_KEY) || "");
    if (!payload) return null;
    return payload.id || payload.userId || payload.sub || payload.user_id || null;
  },

  // Conversation management
  getConversations: async () => {
    const response = await axiosInstance.get(`/chat/conversations`);
    return response.data;
  },

  getConversation: async (conversationId) => {
    const response = await axiosInstance.get(`/chat/conversations/${conversationId}`);
    return response.data;
  },

  createConversation: async (data) => {
    const response = await axiosInstance.post(`/chat/conversations`, data);
    return response.data;
  },

  // Delete a conversation (backend performs a soft delete)
  deleteConversation: async (conversationId) => {
    const response = await axiosInstance.delete(`/chat/conversations/${conversationId}`);
    return response.data;
  },

  // Upload PDF documents (without indexing)
  uploadDocument: async (file) => {
    const formData = new FormData();
    formData.append("pdf", file);

    // No manual Content-Type: axios sets multipart/form-data with the
    // correct boundary itself when the body is FormData.
    const response = await axiosInstance.post(`/upload`, formData);
    return response.data;
  },

  // Index an uploaded document separately
  indexDocument: async (filename) => {
    const response = await axiosInstance.post(`/index`, { filename });
    return response.data;
  },

  getIndexingStatus: async () => {
    const response = await axiosInstance.get(`/indexing-status`);
    return response.data;
  },

  // Query the RAG system. `request` is either a question string or a body
  // object such as { query, conversationId } — both map to a single
  // POST /query; the backend persists the exchange when conversationId is set.
  askQuestion: async (request) => {
    const body = typeof request === "string" ? { query: request } : request;
    const response = await axiosInstance.post(`/query`, body);
    return response.data;
  },

  // Get list of documents
  getDocuments: async () => {
    const response = await axiosInstance.get(`/documents`);
    return response.data;
  },
};

export default api;
