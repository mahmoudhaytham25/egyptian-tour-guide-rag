// Chat engine hook — owns all state, effects, and handlers for the chat UI.
// The components stay purely presentational; everything stateful lives here.

import { useState, useEffect, useRef, useCallback } from "react";
import api from "../../services/api";
import { logout } from "../../utils/logout";
import {
  BACKGROUND_IMAGE_RULES,
  DEFAULT_BACKGROUND,
  DEFAULT_DOCUMENT,
} from "./chatData";
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
  // Non-404 conversation-list failures surface in the sidebar with a retry.
  const [conversationsError, setConversationsError] = useState(false);
  const [conversationsReloadKey, setConversationsReloadKey] = useState(0);
  // Corpus picker: the uploaded documents list and which one the next
  // /query should target. Session-level — not persisted per conversation.
  const [documents, setDocuments] = useState([]);
  const [selectedDocument, setSelectedDocument] = useState(DEFAULT_DOCUMENT);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const streamTimeoutRef = useRef(null);
  const suggestionTimeoutRef = useRef(null);
  const lastScrollAtRef = useRef(0);
  // Monotonic "tickets" for in-flight async work. sendSeqRef identifies the
  // latest /query request; selectSeqRef the latest conversation load. Any
  // path that replaces the chat pane bumps both, so a late resolver can see
  // its ticket went stale and bail instead of writing into the wrong pane.
  const sendSeqRef = useRef(0);
  const selectSeqRef = useRef(0);
  // Mirror of activeConversationId readable inside async closures.
  const activeConversationIdRef = useRef(null);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

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

  // Invalidate all async work targeting the pane: pending timers plus any
  // awaited /query or conversation fetch that resolves later.
  const invalidatePendingWork = useCallback(() => {
    sendSeqRef.current += 1;
    selectSeqRef.current += 1;
    cancelPendingTimers();
  }, [cancelPendingTimers]);

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

  // Mount (and retry): focus the input, then fetch the sidebar list and (if
  // any) the most recent conversation's messages. Async work is gated on
  // `isMounted` so a remount (or StrictMode double-mount) just refetches
  // cleanly; bumping conversationsReloadKey reruns the load.
  useEffect(() => {
    inputRef.current?.focus();

    let isMounted = true;

    const loadConversations = async () => {
      const uid = api.getUserId();
      if (!uid) return; // no token — RequireAuth normally prevents reaching here
      if (!isMounted) return;

      setUserId(uid);
      setIsLoadingHistory(true);
      setConversationsError(false);
      try {
        const list = await api.getConversations();
        if (!isMounted) return;

        const safeList = Array.isArray(list) ? list : [];
        setConversations(safeList);

        // Auto-open the latest conversation only on the initial mount and
        // only when nothing is open — a retry resolving late must not
        // clobber a conversation the user already picked, nor the empty
        // pane they opened via "+ New chat".
        if (
          conversationsReloadKey === 0 &&
          safeList.length > 0 &&
          !activeConversationIdRef.current
        ) {
          const latest = safeList[0];
          try {
            const data = await api.getConversation(latest._id);
            if (!isMounted) return;
            // Commit the id only after the fetch proves the conversation
            // is alive — a dead id committed here would 404 every send.
            setActiveConversationId(latest._id);
            localStorage.setItem(`conversationId_${uid}`, latest._id);
            if (data && Array.isArray(data.messages)) {
              setMessages(data.messages.map(formatConversationMessage));
            }
          } catch {
            // Conversation may have been deleted between calls — non-fatal;
            // leave it unactivated so sends don't inherit the dead id.
          }
        }
        // No conversations yet: one is created lazily on the first send.
      } catch (error) {
        if (!isMounted) return;
        // 404 means the backend has no conversation endpoints — fall back
        // to plain /query calls for the rest of the session.
        if (error.response?.status === 404) {
          setConversationFeaturesAvailable(false);
        } else {
          // Surface the failure in the sidebar (with retry) instead of
          // silently looking like "No conversations yet".
          setConversationsError(true);
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
  }, [cancelPendingTimers, conversationsReloadKey]);

  // Sidebar retry affordance after a failed conversation-list load.
  const retryLoadConversations = useCallback(() => {
    setConversationsReloadKey((key) => key + 1);
  }, []);

  // Unmount-only invalidation: a /query resolving after unmount must not
  // schedule stream chunks or write into the pane. Kept separate from the
  // load effect above — its cleanup also runs on conversationsReloadKey
  // retries, where an in-flight send should survive.
  useEffect(() => {
    return () => invalidatePendingWork();
  }, [invalidatePendingWork]);

  // The document list behind the corpus picker — fetched once on mount and
  // again whenever the picker is focused (a cheap GET), which covers docs
  // uploaded/indexed on the Knowledge Base page since the chat was opened.
  const refreshDocuments = useCallback(async () => {
    if (!api.getUserId()) return; // no token — same guard as conversations
    try {
      const data = await api.getDocuments();
      const fresh = Array.isArray(data?.documents) ? data.documents : [];
      setDocuments(fresh);
      // A selection that vanished from the list or lost its index can't be
      // queried — fall back to the default corpus so the picker never aims
      // /query at a document the backend would reject. Functional update
      // keeps this callback free of a selectedDocument dep.
      setSelectedDocument((prev) =>
        fresh.some((doc) => doc.id === prev && doc.indexed)
          ? prev
          : DEFAULT_DOCUMENT
      );
    } catch {
      // Non-fatal — the picker keeps whatever it already shows.
    }
  }, []);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  // React to a logout in another tab. Same-tab logout already redirects, and
  // the axios response interceptor clears state on a 401.
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === "authToken" && !e.newValue) {
        invalidatePendingWork();
        setMessages([]);
        setConversations([]);
        setActiveConversationId(null);
        setUserId(null);
        setLoading(false);
        setStreaming(false);
        setCurrentStreamedText("");
        setIsLoadingHistory(false);
        // Same as same-tab logout: bounce to the login page in this tab too.
        logout();
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [invalidatePendingWork]);

  // Sidebar helpers ----------------------------------------------------

  // Refresh the sidebar list from GET /chat/conversations
  const refreshConversations = useCallback(async () => {
    try {
      const list = await api.getConversations();
      const safeList = Array.isArray(list) ? list : [];
      setConversations(safeList);
      return safeList;
    } catch {
      return [];
    }
  }, []);

  // The conversation the next /query call should persist into:
  // the selected one, or whatever was previously stored for this user.
  // Reads the ref (not the state var) so a mid-send recovery that just
  // cleared a dead id doesn't hand the stale value straight back.
  const getActiveConversationId = useCallback(() => {
    return (
      activeConversationIdRef.current ||
      (userId ? localStorage.getItem(`conversationId_${userId}`) : null)
    );
  }, [userId]);

  // Lazily create a backend conversation for a brand-new chat so that
  // /query has a conversationId to persist messages into.
  const ensureActiveConversation = useCallback(
    async (question) => {
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
            localStorage.setItem(
              `conversationId_${userId}`,
              newConversation._id
            );
          }
          return newConversation._id;
        }
      } catch {
        // Persistence unavailable — send the question without a conversation.
      }
      return null;
    },
    [
      conversationFeaturesAvailable,
      getActiveConversationId,
      activeConversationId,
      userId,
    ]
  );

  // Send a question to the backend, attaching the active conversationId
  // so the exchange is persisted into that thread.
  const askWithConversation = useCallback(
    async (question) => {
      const conversationId = await ensureActiveConversation(question);

      const requestData = conversationFeaturesAvailable
        ? { query: question, conversationId, document: selectedDocument }
        : { query: question, document: selectedDocument };

      const apiResponse = await api.askQuestion(requestData);

      // Refresh the sidebar so a newly created conversation appears and
      // the ordering reflects the latest activity — but only when this
      // query actually persisted into one.
      if (conversationFeaturesAvailable && conversationId) {
        refreshConversations();
      }

      return apiResponse;
    },
    [
      ensureActiveConversation,
      conversationFeaturesAvailable,
      refreshConversations,
      selectedDocument,
    ]
  );

  // Load a conversation's messages when its sidebar item is clicked.
  const handleSelectConversation = useCallback(
    async (conversation) => {
      if (!conversation || !conversation._id) return;
      if (conversation._id === activeConversationId) return;

      // Invalidate any in-flight send/stream so a pending bot reply can't
      // leak into the conversation being opened, then take this load's
      // ticket — if a newer selection wins the race, this one drops.
      invalidatePendingWork();
      const seq = selectSeqRef.current;
      setStreaming(false);
      setCurrentStreamedText("");
      setLoading(false);
      setIsLoadingHistory(true);

      try {
        const data = await api.getConversation(conversation._id);
        if (seq !== selectSeqRef.current) return; // a newer selection won

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
        if (seq !== selectSeqRef.current) return;
        setMessages((prev) => [
          ...prev,
          makeLocalMessage("error", "Could not load that conversation."),
        ]);
      } finally {
        if (seq === selectSeqRef.current) {
          setIsLoadingHistory(false);
        }
      }
    },
    [activeConversationId, userId, invalidatePendingWork]
  );

  // "New chat": clear the pane; the next send lazily creates a conversation.
  const handleNewChat = useCallback(() => {
    invalidatePendingWork();
    setMessages([]);
    setCurrentStreamedText("");
    setStreaming(false);
    setLoading(false);
    setIsLoadingHistory(false);
    setActiveConversationId(null);
    if (userId) {
      localStorage.removeItem(`conversationId_${userId}`);
    }
    localStorage.removeItem("conversationId"); // legacy key cleanup
    inputRef.current?.focus();
  }, [userId, invalidatePendingWork]);

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
  const finishStreaming = useCallback((completeText) => {
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
  }, []);

  // Reveal the answer progressively — ~4 chars per ~30ms tick instead of one
  // re-render per character.
  const simulateStreaming = useCallback(
    (text) => {
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
    },
    [cancelPendingTimers, finishStreaming]
  );

  // Shared send path used by the send button, Enter, and suggestion buttons.
  const sendQuestion = useCallback(
    async (question) => {
      const trimmed = (question || "").trim();
      if (!trimmed || loading || streaming || isLoadingHistory) return;

      // Take this send's ticket — selecting a conversation, starting a new
      // chat, or logging out bumps it so the awaited reply below drops
      // instead of landing in a pane the user has already left.
      const seq = ++sendSeqRef.current;

      // One-shot guard for the stale-conversation recovery below — the
      // retry goes through a fresh conversation, so a second 404 is a
      // real failure, not another recovery attempt.
      let conversationRecovered = false;

      cancelPendingTimers(); // never run two streams at once
      setMessages((prev) => [...prev, makeLocalMessage("user", trimmed)]);
      setInput("");
      setLoading(true);

      try {
        const apiResponse = await askWithConversation(trimmed);
        if (seq !== sendSeqRef.current) return; // stale — pane moved on
        simulateStreaming(extractAnswerText(apiResponse));
      } catch (error) {
        if (seq !== sendSeqRef.current) return;

        // A 404 while a conversationId was attached means that
        // conversation is gone (deleted or never persisted) — drop the
        // dead id everywhere and retry once; ensureActiveConversation
        // lazily creates a fresh conversation for the retry.
        if (
          error.response?.status === 404 &&
          conversationFeaturesAvailable &&
          !conversationRecovered &&
          (activeConversationIdRef.current ||
            (userId && localStorage.getItem(`conversationId_${userId}`)))
        ) {
          conversationRecovered = true;
          setActiveConversationId(null);
          activeConversationIdRef.current = null;
          if (userId) {
            localStorage.removeItem(`conversationId_${userId}`);
          }
          try {
            const retryResponse = await askWithConversation(trimmed);
            if (seq !== sendSeqRef.current) return;
            simulateStreaming(extractAnswerText(retryResponse));
            return;
          } catch (retryError) {
            if (seq !== sendSeqRef.current) return;
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

        // A 400 whose message names the conversation — or an unlabeled
        // 400 — means this backend rejected the persistence payload
        // itself: disable it and retry once as a plain query. Labeled
        // 400s about something else ('Question is too long', 'Invalid
        // document name', ...) are ordinary user-facing errors that must
        // not flip the feature flag.
        const errorMessage = error.response?.data?.message;
        if (
          error.response?.status === 400 &&
          conversationFeaturesAvailable &&
          (!errorMessage || /conversation/i.test(errorMessage))
        ) {
          setConversationFeaturesAvailable(false);
          try {
            const retryResponse = await api.askQuestion({
              query: trimmed,
              document: selectedDocument,
            });
            if (seq !== sendSeqRef.current) return;
            simulateStreaming(extractAnswerText(retryResponse));
            return;
          } catch (retryError) {
            if (seq !== sendSeqRef.current) return;
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
    },
    [
      loading,
      streaming,
      isLoadingHistory,
      cancelPendingTimers,
      askWithConversation,
      simulateStreaming,
      conversationFeaturesAvailable,
      selectedDocument,
      userId,
    ]
  );

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || loading || streaming || isLoadingHistory) return;

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
  }, [input, loading, streaming, isLoadingHistory, messages.length, sendQuestion]);

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

      // Start fetching the next backdrop now so it's cached by the time the
      // fade-out finishes and the <img> src swaps — avoids a blank flash.
      new Image().src = newImage;

      const fadeTimeout = setTimeout(() => {
        setBackgroundImage(newImage);
        setFade(false); // fade-in new background
      }, 400); // half of the transition duration

      return () => clearTimeout(fadeTimeout);
    }
  }, [messages, backgroundImage]);

  const handleKeyPress = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleLogout = logout;

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
    conversationsError,
    documents,
    selectedDocument,
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
    retryLoadConversations,
    setSelectedDocument,
    refreshDocuments,
  };
};

export default useChat;
