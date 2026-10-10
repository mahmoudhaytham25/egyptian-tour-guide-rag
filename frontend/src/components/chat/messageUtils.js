// Pure helpers shared by the chat engine (useChat) and the view components.

import { TOPIC_SUGGESTIONS, GENERAL_SUGGESTIONS } from "./chatData";

/* Fake-streaming tuning: reveal the answer in ~4-char chunks every ~30ms. */
export const STREAM_CHUNK_SIZE = 4;
export const STREAM_DELAY_MS = 30;
/* scrollIntoView is throttled while streaming so it runs at most ~8x/sec. */
export const SCROLL_THROTTLE_MS = 120;
export const SUGGESTIONS_DELAY_MS = 1000;
export const GENERIC_ERROR_MESSAGE =
  "Sorry, I encountered an error processing your request.";

// Locally created messages get a generated id so React keys stay stable even
// before the message exists in the database (where it has an _id).
let localMessageSeq = 0;
export const makeLocalMessage = (type, content, extra = {}) => ({
  id: `local-${Date.now()}-${localMessageSeq++}`,
  type,
  content,
  timestamp: new Date().toISOString(),
  ...extra,
});

// Convert a persisted message doc to the shape the UI renders.
export const formatConversationMessage = (msg) => ({
  _id: msg._id,
  type: msg.role === "user" ? "user" : "bot",
  content: msg.content,
  timestamp: msg.timestamp,
});

export const messageKey = (msg, index) =>
  msg._id || msg.id || msg.timestamp || `msg-${index}`;

// Small "HH:MM" label under a bubble; empty when the timestamp is unusable.
export const formatMessageTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

// Pull the answer text out of whatever /query (or a fallback) returned.
// Anything unrecognized falls back to the generic error string — never
// render raw JSON into a chat bubble.
export const extractAnswerText = (response) => {
  if (typeof response === "string") {
    return response;
  }
  if (response && typeof response === "object") {
    if (typeof response.answer === "string") return response.answer;
    if (typeof response.response === "string") return response.response;
  }
  return GENERIC_ERROR_MESSAGE;
};

// Detect vague questions and provide suggestions instead of querying.
export const detectVagueQuestion = (question) => {
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
export const generateFollowUpSuggestions = (lastResponse) => {
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
