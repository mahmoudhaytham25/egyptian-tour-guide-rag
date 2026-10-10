// Chat engine hook — owns all state, effects, and handlers for the chat UI.
// The components stay purely presentational; everything stateful lives here.

import { useState, useEffect, useRef, useCallback } from "react";
import api from "../../services/api";
import { BACKGROUND_IMAGE_RULES, DEFAULT_BACKGROUND } from "./chatData";
import {
  STREAM_CHUNK_SIZE,
  STREAM_DELAY_MS,
  SCROLL_THROTTLE_MS,
  SUGGESTIONS_DELAY_MS,
  GENERIC_ERROR_MESSAGE,
  makeLocalMessage,
  formatConversationMessage,
  extractAnswerText,
  detectVagueQuestion,
  generateFollowUpSuggestions,
} from "./messageUtils";

const useChat = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [currentStreamedText, setCurrentStreamedText] = useState("");
  const [conversationFeaturesAvailable, setConversationFeaturesAvailable] =
    useState(true);
  const [userId, setUserId] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState(DEFAULT_BACKGROUND);
  const [fade, setFade] = useState(false);
  // Chat history sidebar state
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const streamTimeoutRef = useRef(null);
  const suggestionTimeoutRef = useRef(null);
  const lastScrollAtRef = useRef(0);

  // Cancel every pending timer (stream chunks, delayed suggestions) so a
  // bot reply can never land in a conversation the user has already left.
  const cancelPendingTimers = useCallback(() => {
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
    if (suggestionTimeoutRef.current) {
      clearTimeout(suggestionTimeoutRef.current);
      suggestionTimeoutRef.current = null;
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Throttled auto-scroll: always scroll on committed message updates; while
  // streaming, scroll at most once per SCROLL_THROTTLE_MS.
  useEffect(() => {
    const now = Date.now();
    if (streaming && now - lastScrollAtRef.current < SCROLL_THROTTLE_MS) {
      return;
    }
    lastScrollAtRef.current = now;
    scrollToBottom();
  }, [messages, currentStreamedText, streaming]);

  // Mount: focus the input, then fetch the sidebar list and (if any) the most
  // recent conversation's messages. Async work is gated on `isMounted` so a
  // remount (or StrictMode double-mount) just refetches cleanly.
  useEffect(() => {
    inputRef.current?.focus();

    let isMounted = true;

    const loadConversations = async () => {
      const uid = api.getUserId();
      if (!uid) return; // no token — RequireAuth normally prevents reaching here
      if (!isMounted) return;

      setUserId(uid);
      setIsLoadingHistory(true);
      try {
        const list = await api.getConversations();
        if (!isMounted) return;

        const safeList = Array.isArray(list) ? list : [];
        setConversations(safeList);

        if (safeList.length > 0) {
          const latest = safeList[0];
          setActiveConversationId(latest._id);
          localStorage.setItem(`conversationId_${uid}`, latest._id);

          try {
            const data = await api.getConversation(latest._id);
            if (!isMounted) return;
            if (data && Array.isArray(data.messages)) {
              setMessages(data.messages.map(formatConversationMessage));
            }
          } catch {
            // Conversation may have been deleted between calls — non-fatal.
          }
        }
        // No conversations yet: one is created lazily on the first send.
      } catch (error) {
        if (!isMounted) return;
        // 404 means the backend has no conversation endpoints — fall back
        // to plain /query calls for the rest of the session.
        if (error.response?.status === 404) {
          setConversationFeaturesAvailable(false);
        }
      } finally {
        if (isMounted) {
          setIsLoadingHistory(false);
        }
      }
    };

    loadConversations();

    return () => {
      isMounted = false;
      cancelPendingTimers();
    };
  }, [cancelPendingTimers]);

  // React to a logout in another tab. Same-tab logout already redirects, and
  // the axios response interceptor clears state on a 401.
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === "authToken" && !e.newValue) {
        cancelPendingTimers();
        setMessages([]);
        setConversations([]);
        setActiveConversationId(null);
        setUserId(null);
        setLoading(false);
        setStreaming(false);
        setCurrentStreamedText("");
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [cancelPendingTimers]);

  // Sidebar helpers ----------------------------------------------------

  // Refresh the sidebar list from GET /chat/conversations
  const refreshConversations = async () => {
    try {
      const list = await api.getConversations();
      const safeList = Array.isArray(list) ? list : [];
      setConversations(safeList);
      return safeList;
    } catch {
      return [];
    }
  };

  // The conversation the next /query call should persist into:
  // the selected one, or whatever was previously stored for this user.
  const getActiveConversationId = () => {
    return (
      activeConversationId ||
      (userId ? localStorage.getItem(`conversationId_${userId}`) : null)
    );
  };

  // Lazily create a backend conversation for a brand-new chat so that
  // /query has a conversationId to persist messages into.
  const ensureActiveConversation = async (question) => {
    if (!conversationFeaturesAvailable) return null;

    const existingId = getActiveConversationId();
    if (existingId) {
      if (existingId !== activeConversationId) {
        setActiveConversationId(existingId);
      }
      return existingId;
    }

    try {
      const newConversation = await api.createConversation({
        title: question.slice(0, 40) || "New Conversation",
      });

      if (newConversation && newConversation._id) {
        setActiveConversationId(newConversation._id);
        if (userId) {
          localStorage.setItem(`conversationId_${userId}`, newConversation._id);
        }
        return newConversation._id;
      }
    } catch {
      // Persistence unavailable — send the question without a conversation.
    }
    return null;
  };

  // Send a question to the backend, attaching the active conversationId
  // so the exchange is persisted into that thread.
  const askWithConversation = async (question) => {
    const conversationId = await ensureActiveConversation(question);

    const requestData = conversationFeaturesAvailable
      ? { query: question, conversationId }
      : { query: question };

    const apiResponse = await api.askQuestion(requestData);

    // Refresh the sidebar so a newly created conversation appears and
    // the ordering reflects the latest activity.
    refreshConversations();

    return apiResponse;
  };

  // Load a conversation's messages when its sidebar item is clicked.
  const handleSelectConversation = useCallback(
    async (conversation) => {
      if (!conversation || !conversation._id) return;
      if (conversation._id === activeConversationId) return;

      // Cancel any in-flight stream so the pending bot reply can't leak
      // into the conversation being opened.
      cancelPendingTimers();
      setStreaming(false);
      setCurrentStreamedText("");
      setLoading(false);
      setIsLoadingHistory(true);

      try {
        const data = await api.getConversation(conversation._id);

        const formattedMessages =
          data && Array.isArray(data.messages)
            ? data.messages.map(formatConversationMessage)
            : [];

        setMessages(formattedMessages);
        setActiveConversationId(conversation._id);
        if (userId) {
          localStorage.setItem(`conversationId_${userId}`, conversation._id);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          makeLocalMessage("error", "Could not load that conversation."),
        ]);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [activeConversationId, userId, cancelPendingTimers]
  );

  // "New chat": clear the pane; the next send lazily creates a conversation.
  const handleNewChat = useCallback(() => {
    cancelPendingTimers();
    setMessages([]);
    setCurrentStreamedText("");
    setStreaming(false);
    setLoading(false);
    setActiveConversationId(null);
    if (userId) {
      localStorage.removeItem(`conversationId_${userId}`);
    }
    localStorage.removeItem("conversationId"); // legacy key cleanup
    inputRef.current?.focus();
  }, [userId, cancelPendingTimers]);

  // Delete a conversation (soft delete on the backend).
  const handleDeleteConversation = useCallback(
    async (conversation) => {
      if (!conversation || !conversation._id) return;
      if (!window.confirm("Delete this conversation?")) return;

      try {
        await api.deleteConversation(conversation._id);
      } catch {
        setMessages((prev) => [
          ...prev,
          makeLocalMessage("error", "Could not delete that conversation."),
        ]);
        return;
      }

      setConversations((prev) =>
        prev.filter((c) => c._id !== conversation._id)
      );

      if (conversation._id === activeConversationId) {
        handleNewChat();
      }
    },
    [activeConversationId, handleNewChat]
  );

  // Called when streaming is complete
  const finishStreaming = (completeText) => {
    setMessages((prev) => [...prev, makeLocalMessage("bot", completeText)]);

    setStreaming(false);
    setCurrentStreamedText("");
    setLoading(false);

    // Generate and add follow-up suggestions
    const suggestions = generateFollowUpSuggestions(completeText);
    if (suggestions.length > 0) {
      suggestionTimeoutRef.current = setTimeout(() => {
        suggestionTimeoutRef.current = null;
        setMessages((prev) => [
          ...prev,
          makeLocalMessage("suggestions", "You might also want to ask:", {
            suggestions,
          }),
        ]);
      }, SUGGESTIONS_DELAY_MS);
    }
  };

  // Reveal the answer progressively — ~4 chars per ~30ms tick instead of one
  // re-render per character.
  const simulateStreaming = (text) => {
    cancelPendingTimers();
    setStreaming(true);
    setCurrentStreamedText("");

    if (text.length <= STREAM_CHUNK_SIZE) {
      finishStreaming(text);
      return;
    }

    let index = STREAM_CHUNK_SIZE;
    setCurrentStreamedText(text.slice(0, index));

    const showNextChunk = () => {
      index += STREAM_CHUNK_SIZE;
      if (index < text.length) {
        setCurrentStreamedText(text.slice(0, index));
        streamTimeoutRef.current = setTimeout(showNextChunk, STREAM_DELAY_MS);
      } else {
        streamTimeoutRef.current = null;
        finishStreaming(text);
      }
    };

    streamTimeoutRef.current = setTimeout(showNextChunk, STREAM_DELAY_MS);
  };

  // Shared send path used by the send button, Enter, and suggestion buttons.
  const sendQuestion = async (question) => {
    const trimmed = (question || "").trim();
    if (!trimmed || loading || streaming || isLoadingHistory) return;

    cancelPendingTimers(); // never run two streams at once
    setMessages((prev) => [...prev, makeLocalMessage("user", trimmed)]);
    setInput("");
    setLoading(true);

    try {
      const apiResponse = await askWithConversation(trimmed);
      simulateStreaming(extractAnswerText(apiResponse));
    } catch (error) {
      // A 400 while conversation features are enabled means the backend
      // rejected the conversation payload — retry once as a plain query.
      if (error.response?.status === 400 && conversationFeaturesAvailable) {
        setConversationFeaturesAvailable(false);
        try {
          const retryResponse = await api.askQuestion({ query: trimmed });
          simulateStreaming(extractAnswerText(retryResponse));
          return;
        } catch (retryError) {
          setMessages((prev) => [
            ...prev,
            makeLocalMessage(
              "error",
              retryError.response?.data?.message || GENERIC_ERROR_MESSAGE
            ),
          ]);
          setLoading(false);
          return;
        }
      }

      setMessages((prev) => [
        ...prev,
        makeLocalMessage(
          "error",
          error.response?.data?.message || GENERIC_ERROR_MESSAGE
        ),
      ]);
      setLoading(false);
    }
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || loading || streaming) return;

    // For a vague first question, guide the user instead of querying.
    if (messages.length === 0 && detectVagueQuestion(trimmed)) {
      setMessages([
        makeLocalMessage(
          "bot",
          "I'd be happy to help! To get the most accurate answer, please be more specific about what you'd like to know. For example:\n\n• \"What does the Great Pyramid represent?\"\n• \"What does the Sphinx symbolize?\"\n• \"What does the Eye of Horus mean?\"\n\nWhat specific aspect of Egyptian history would you like to learn about?"
        ),
      ]);
      setInput("");
      return;
    }

    sendQuestion(trimmed);
  };

  // Swap the themed background image based on the latest user message.
  useEffect(() => {
    const lastUserMessage = [...messages]
      .reverse()
      .find((msg) => msg.type === "user");
    const query = lastUserMessage ? lastUserMessage.content.toLowerCase() : "";

    const match = BACKGROUND_IMAGE_RULES.find((item) =>
      item.keywords.some((keyword) => query.includes(keyword.toLowerCase()))
    );

    const newImage = match ? match.img : DEFAULT_BACKGROUND;

    if (newImage !== backgroundImage) {
      setFade(true); // trigger fade-out

      const fadeTimeout = setTimeout(() => {
        setBackgroundImage(newImage);
        setFade(false); // fade-in new background
      }, 400); // half of the transition duration

      return () => clearTimeout(fadeTimeout);
    }
  }, [messages, backgroundImage]);

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleLogout = () => {
    api.logout();
    window.location.href = "/"; // Redirect to login page
  };

  return {
    // state
    messages,
    input,
    setInput,
    loading,
    streaming,
    currentStreamedText,
    isLoadingHistory,
    backgroundImage,
    fade,
    conversations,
    activeConversationId,
    isBusy: loading || streaming,
    // refs
    messagesEndRef,
    inputRef,
    // handlers
    sendQuestion,
    handleSend,
    handleKeyPress,
    handleLogout,
    handleSelectConversation,
    handleNewChat,
    handleDeleteConversation,
  };
};

export default useChat;
