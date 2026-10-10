import React, { useState, useEffect, useRef, useCallback } from "react";
import api from "../services/api";
import HistoryDisplay from "./HistoryDisplay";
import "./ChatInterface.css";

import icon from "../Assets/Images/pharaoh-icon.png";

import pyramids from "../Assets/Images/Pyramids.png";
import sabilKuttab from "../Assets/Images/sabil-kuttab.jpg";
import romanAmphitheater from "../Assets/Images/roman-amphitheater.jpg";
import catacombsKomElShoqafa from "../Assets/Images/catacombsKomElShoqafa.jpg";
import pompeysPillar from "../Assets/Images/pompeysPillar.jpg";
import blackPyramid from "../Assets/Images/blackPyramid.jpg";
import greatPyramid from "../Assets/Images/greatPyramid.jpg";
import khafrePyramid from "../Assets/Images/khafrePyramid.jpg";
import menkaurePyramid from "../Assets/Images/menkaurePyramid.jpg";
import sphinxGiza from "../Assets/Images/sphinxGiza.jpg";
import karnakTemple from "../Assets/Images/karnakTemple.jpg";
import luxorTemple from "../Assets/Images/luxorTemple.jpg";
import valleyOfTheKings from "../Assets/Images/valleyOfTheKings.jpg";
import abuSimbelTemple from "../Assets/Images/abuSimbelTemple.jpg";
import philaeTemple from "../Assets/Images/philaeTemple.jpg";
import saqqaraStepPyramid from "../Assets/Images/saqqaraStepPyramid.jpg";

/* Keywords in the last user message → themed background image. */
const BACKGROUND_IMAGE_RULES = [
  { keywords: ["pyramids", "giza", "egypt pyramids"], img: pyramids },
  { keywords: ["sabil kuttab", "abd elrahman katkhuda"], img: sabilKuttab },
  {
    keywords: [
      "greco",
      "roman",
      "Roman amphitheater",
      "kom el-dikka",
      "alexandria",
    ],
    img: romanAmphitheater,
  },
  {
    keywords: [
      "catacombs",
      "kom el-shoqafa",
      "alexandria",
      "rock-cut tombs",
      "2nd century",
      "burial site",
      "roman egypt",
    ],
    img: catacombsKomElShoqafa,
  },
  {
    keywords: [
      "pompey's pillar",
      "alexandria",
      "roman column",
      "diocletian",
      "ancient alexandria",
      "roman egypt",
      "pillar of pompey",
      "alexandria landmarks",
      "monument",
      "egyptian roman ruins",
      "greco-roman",
      "granite column",
      "serapeum",
      "ruins of serapeum",
      "3rd century",
    ],
    img: pompeysPillar,
  },

  {
    keywords: [
      "black pyramid",
      "king amenemhat iii",
      "dahshur",
      "middle kingdom",
      "mudbrick pyramid",
      "collapsed pyramid",
      "amenemhat pyramid",
    ],
    img: blackPyramid,
  },
  {
    keywords: [
      "great pyramid",
      "pyramid of khufu",
      "giza",
      "great pyramid of giza",
      "cheops",
      "old kingdom",
      "largest pyramid",
      "seven wonders",
      "pyramids",
    ],
    img: greatPyramid,
  },
  {
    keywords: [
      "pyramid of khafre",
      "khafre",
      "giza",
      "middle pyramid",
      "second pyramid",
      "chephren",
      "pyramids",
    ],
    img: khafrePyramid,
  },
  {
    keywords: [
      "pyramid of menkaure",
      "menkaure",
      "giza",
      "third pyramid",
      "smallest pyramid",
      "pyramids",
    ],
    img: menkaurePyramid,
  },
  {
    keywords: [
      "sphinx",
      "great sphinx",
      "sphinx of giza",
      "giza",
      "lion statue",
      "khafre sphinx",
      "ancient egypt",
      "guardian of pyramids",
    ],
    img: sphinxGiza,
  },
  {
    keywords: [
      "temple of karnak",
      "karnak",
      "thebes",
      "luxor",
      "amun-ra",
      "hypostyle hall",
      "ancient temple",
      "new kingdom",
      "egyptian temples",
    ],
    img: karnakTemple,
  },
  {
    keywords: [
      "luxor temple",
      "luxor",
      "temple of luxor",
      "thebes",
      "amun",
      "ancient egypt",
      "night temple",
      "obelisk",
      "new kingdom",
    ],
    img: luxorTemple,
  },
  {
    keywords: [
      "valley of the kings",
      "thebes",
      "luxor",
      "royal tombs",
      "pharaoh tombs",
      "tutankhamun",
      "new kingdom",
      "necropolis",
      "burial site",
    ],
    img: valleyOfTheKings,
  },
  {
    keywords: [
      "temple of abu simbel",
      "abu simbel",
      "ramses ii",
      "great temple",
      "nubia",
      "rock-cut temple",
      "aswan",
      "sun festival",
      "ancient egypt",
      "new kingdom",
    ],
    img: abuSimbelTemple,
  },
  {
    keywords: [
      "philae temple",
      "philae",
      "isis temple",
      "temple of isis",
      "aswan",
      "greco-roman egypt",
      "island temple",
      "ancient egyptian temple",
      "philae island",
    ],
    img: philaeTemple,
  },
  {
    keywords: [
      "saqqara",
      "step pyramid",
      "pyramid of djoser",
      "djoser",
      "saqqara step pyramid",
      "oldest pyramid",
      "old kingdom",
      "necropolis",
      "memphis",
    ],
    img: saqqaraStepPyramid,
  },
];

/* Follow-up question pools keyed by topic, used to build suggestion buttons. */
const TOPIC_SUGGESTIONS = {
  pyramids: [
    "How were the pyramids built?",
    "Who were the pharaohs buried in pyramids?",
    "What's inside the pyramids?",
    "How long did it take to build the Great Pyramid?",
    "What tools did they use to build pyramids?",
    "Why were pyramids built in that shape?",
    "How many pyramids are there in Egypt?",
    "What was the purpose of the pyramid complex?",
    "How did they transport the stones?",
    "What's the significance of pyramid alignment?"
  ],
  temples: [
    "What was the purpose of Egyptian temples?",
    "How were temples decorated?",
    "Who could enter temples?",
    "What ceremonies took place in temples?",
    "How were temples funded?",
    "What's the difference between mortuary and cult temples?",
    "How were temples oriented?",
    "What role did priests play in temples?",
    "How were temples maintained?",
    "What happened during temple festivals?"
  ],
  pharaohs: [
    "How did pharaohs rule Egypt?",
    "What was the role of pharaohs in religion?",
    "How were pharaohs chosen?",
    "What powers did pharaohs have?",
    "How did pharaohs communicate with the gods?",
    "What was the pharaoh's daily life like?",
    "How were pharaohs buried?",
    "What titles did pharaohs have?",
    "How did pharaohs maintain power?",
    "What happened when a pharaoh died?"
  ],
  gods: [
    "Who were the main Egyptian gods?",
    "How did Egyptians worship their gods?",
    "What were Egyptian religious beliefs?",
    "What was the role of animal gods?",
    "How were gods represented in art?",
    "What were the major religious festivals?",
    "How did gods influence daily life?",
    "What was the relationship between gods and pharaohs?",
    "How were gods worshipped in homes?",
    "What happened to Egyptian religion over time?"
  ],
  afterlife: [
    "What did Egyptians believe about the afterlife?",
    "How did they prepare for death?",
    "What was mummification?",
    "What was the Book of the Dead?",
    "How did they judge souls in the afterlife?",
    "What was the journey to the afterlife like?",
    "What did they bury with the dead?",
    "How did they protect tombs?",
    "What was the role of the heart in the afterlife?",
    "How did beliefs about the afterlife change?"
  ],
  alexandria: [
    "What was Alexandria like in ancient times?",
    "Who founded Alexandria?",
    "What was the Library of Alexandria?",
    "What happened to the Pharos Lighthouse?",
    "What was Cleopatra's role in Alexandria?",
    "How did Alexandria become a center of learning?",
    "What was the cultural mix in Alexandria?",
    "How did Alexandria influence the Mediterranean?",
    "What remains of ancient Alexandria today?",
    "What was the significance of Alexandria's location?"
  ],
  cairo: [
    "What was Cairo like in ancient times?",
    "How did Cairo develop over time?",
    "What are the oldest parts of Cairo?",
    "What was the role of Cairo in Islamic Egypt?",
    "How did Cairo become the capital?",
    "What architectural styles are found in Cairo?",
    "What was medieval Cairo like?",
    "How did Cairo influence trade routes?",
    "What are Cairo's most important monuments?",
    "How has Cairo changed over centuries?"
  ],
  sphinx: [
    "What is the Great Sphinx?",
    "Who built the Sphinx?",
    "What does the Sphinx represent?",
    "How old is the Sphinx?",
    "What was the Sphinx's original purpose?",
    "How was the Sphinx carved?",
    "What happened to the Sphinx's nose?",
    "What's the connection between the Sphinx and pyramids?",
    "How has the Sphinx been restored?",
    "What mysteries surround the Sphinx?"
  ],
  valley: [
    "What is the Valley of the Kings?",
    "Why was it chosen for royal burials?",
    "How many tombs are in the Valley?",
    "What was the most famous discovery there?",
    "How were the tombs decorated?",
    "What was the purpose of the valley?",
    "How did they protect the tombs?",
    "What happened to the valley over time?",
    "How were the tombs discovered?",
    "What treasures were found in the valley?"
  ],
  nile: [
    "What was the importance of the Nile?",
    "How did the Nile shape Egyptian civilization?",
    "What was the annual flooding like?",
    "How did Egyptians use the Nile for transport?",
    "What was the Nile's role in agriculture?",
    "How did the Nile influence religion?",
    "What was the Nile's role in trade?",
    "How did they navigate the Nile?",
    "What was the Nile's role in warfare?",
    "How has the Nile changed over time?"
  ],
  hieroglyphs: [
    "What are hieroglyphs?",
    "How were hieroglyphs deciphered?",
    "What was the Rosetta Stone?",
    "How many hieroglyphic symbols were there?",
    "Who could read and write hieroglyphs?",
    "How were hieroglyphs used?",
    "What other writing systems did Egyptians use?",
    "How did hieroglyphs evolve?",
    "What was the purpose of hieroglyphs?",
    "How do we translate hieroglyphs today?"
  ]
};

const GENERAL_SUGGESTIONS = [
  "What was daily life like in ancient Egypt?",
  "How did ancient Egyptians view time?",
  "What was the role of women in ancient Egypt?",
  "How did ancient Egyptians trade with other civilizations?",
  "What was the education system like?",
  "How did ancient Egyptians measure time?",
  "What was the role of music in ancient Egypt?",
  "How did ancient Egyptians view foreigners?",
  "What was the role of magic in ancient Egypt?",
  "How did ancient Egyptians view the stars?"
];

/* Fake-streaming tuning: reveal the answer in ~4-char chunks every ~30ms. */
const STREAM_CHUNK_SIZE = 4;
const STREAM_DELAY_MS = 30;
/* scrollIntoView is throttled while streaming so it runs at most ~8x/sec. */
const SCROLL_THROTTLE_MS = 120;
const SUGGESTIONS_DELAY_MS = 1000;
const GENERIC_ERROR_MESSAGE =
  "Sorry, I encountered an error processing your request.";

// Locally created messages get a generated id so React keys stay stable even
// before the message exists in the database (where it has an _id).
let localMessageSeq = 0;
const makeLocalMessage = (type, content, extra = {}) => ({
  id: `local-${Date.now()}-${localMessageSeq++}`,
  type,
  content,
  timestamp: new Date().toISOString(),
  ...extra,
});

// Convert a persisted message doc to the shape the UI renders.
const formatConversationMessage = (msg) => ({
  _id: msg._id,
  type: msg.role === "user" ? "user" : "bot",
  content: msg.content,
  timestamp: msg.timestamp,
});

const messageKey = (msg, index) =>
  msg._id || msg.id || msg.timestamp || `msg-${index}`;

// Pull the answer text out of whatever /query (or a fallback) returned.
const extractAnswerText = (response) => {
  if (typeof response === "string") {
    return response;
  }
  if (response && typeof response === "object") {
    if (typeof response.answer === "string") return response.answer;
    if (typeof response.response === "string") return response.response;
    return JSON.stringify(response);
  }
  return String(response);
};

// Detect vague questions and provide suggestions instead of querying.
const detectVagueQuestion = (question) => {
  const vaguePatterns = [
    /^what (is|does) (it|this|that) (mean|represent|refer to)\??$/i,
    /^what (is|does) (it|this|that)\??$/i,
    /^what about (it|this|that)\??$/i,
    /^tell me more$/i,
    /^explain$/i,
    /^how$/i,
    /^why$/i
  ];

  return vaguePatterns.some((pattern) => pattern.test(question.trim()));
};

// Simple keyword matching on the last response to pick follow-up questions.
const generateFollowUpSuggestions = (lastResponse) => {
  const responseLower = lastResponse.toLowerCase();
  const allSuggestions = [];

  if (responseLower.includes("pyramid")) {
    allSuggestions.push(...TOPIC_SUGGESTIONS.pyramids);
  }
  if (responseLower.includes("temple")) {
    allSuggestions.push(...TOPIC_SUGGESTIONS.temples);
  }
  if (responseLower.includes("pharaoh") || responseLower.includes("king")) {
    allSuggestions.push(...TOPIC_SUGGESTIONS.pharaohs);
  }
  if (responseLower.includes("god") || responseLower.includes("religious")) {
    allSuggestions.push(...TOPIC_SUGGESTIONS.gods);
  }
  if (
    responseLower.includes("afterlife") ||
    responseLower.includes("death") ||
    responseLower.includes("mummy")
  ) {
    allSuggestions.push(...TOPIC_SUGGESTIONS.afterlife);
  }
  if (responseLower.includes("alexandria")) {
    allSuggestions.push(...TOPIC_SUGGESTIONS.alexandria);
  }
  if (responseLower.includes("cairo")) {
    allSuggestions.push(...TOPIC_SUGGESTIONS.cairo);
  }
  if (responseLower.includes("sphinx")) {
    allSuggestions.push(...TOPIC_SUGGESTIONS.sphinx);
  }
  if (responseLower.includes("valley") || responseLower.includes("tomb")) {
    allSuggestions.push(...TOPIC_SUGGESTIONS.valley);
  }
  if (responseLower.includes("nile")) {
    allSuggestions.push(...TOPIC_SUGGESTIONS.nile);
  }
  if (
    responseLower.includes("hieroglyph") ||
    responseLower.includes("writing") ||
    responseLower.includes("rosetta")
  ) {
    allSuggestions.push(...TOPIC_SUGGESTIONS.hieroglyphs);
  }

  if (allSuggestions.length === 0) {
    allSuggestions.push(...GENERAL_SUGGESTIONS);
  }

  // Remove duplicates, shuffle, return 3
  const uniqueSuggestions = [...new Set(allSuggestions)];
  return uniqueSuggestions.sort(() => Math.random() - 0.5).slice(0, 3);
};

const ChatInterface = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [currentStreamedText, setCurrentStreamedText] = useState("");
  const [conversationFeaturesAvailable, setConversationFeaturesAvailable] =
    useState(true);
  const [userId, setUserId] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState(pyramids);
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

    const newImage = match ? match.img : pyramids;

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

  return (
    <div className="chat-layout">
      <HistoryDisplay
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        onDelete={handleDeleteConversation}
      />
    <div className="chat-container">
      <header className="chat-header">
        <h2>🏺 Egyptian History Assistant</h2>
        <p>Powered by RAG Technology</p>
        <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
          <button
            onClick={() => {
              api.logout();
              window.location.href = '/'; // Redirect to login page
            }}
            style={{
              background: '#666',
              color: 'white',
              border: 'none',
              padding: '5px 10px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            Logout
          </button>
        </div>
      </header>
      <img
        src={backgroundImage}
        alt=""
        className={`imgCover ${fade ? "fade-out" : ""}`}
      />

      <div className="chat-messages h-100">
        {messages.map((msg, index) => (
          <div
            key={messageKey(msg, index)}
            className={`message-wrapper ${
              msg.type === "user" ? "user-wrapper" : "bot-wrapper"
            }`}
          >
            {msg.type !== "user" && (
              <div className="avatar bot-avatar">
                <img src={icon} alt="" />
              </div>
            )}
            {msg.type === "user" && (
              <div className="avatar user-avatar">You</div>
            )}

            <div className={`message ${msg.type}`}>
              <div className="message-content">{msg.content}</div>

              {/* Render suggestions if available */}
              {msg.type === "suggestions" && msg.suggestions && (
                <div className="suggestions-container">
                  {msg.suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      className="suggestion-button"
                      disabled={loading || streaming}
                      onClick={() => sendQuestion(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoadingHistory && messages.length === 0 && (
          <div className="welcome-message">
            <p>Loading conversation…</p>
          </div>
        )}

        {streaming && (
          <div className="message-wrapper bot-wrapper">
            <div className="avatar bot-avatar">
              <img src={icon} alt="Bot" />
            </div>
            <div className="message bot">
              <div className="message-content">{currentStreamedText}</div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="Type your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            rows={1}
          />
          <button
            className="send-button"
            onClick={handleSend}
            disabled={!input.trim() || loading || streaming}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="white"
              viewBox="0 0 24 24"
              width="18"
              height="18"
            >
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </button>
        </div>
        <div className="input-footer">
          <div className="input-hint">Press Enter to send, Shift+Enter for a new line</div>
        </div>
      </div>
    </div>
    </div>
  );
};

export default ChatInterface;
