import React from "react";
import "./chat/chat.css";

// Format the conversation timestamp for the sidebar label:
// "HH:MM" if it was updated today, otherwise "Mon D, YYYY".
const formatConversationDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();

  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
};

// Sidebar label: use the title set by the backend (derived from the first
// user message when none was provided), falling back to a friendly default.
const conversationLabel = (conversation) => {
  if (conversation.title && conversation.title.trim()) {
    return conversation.title;
  }
  return "Untitled chat";
};

/**
 * Left sidebar listing the user's previous conversations.
 *
 * Props:
 *  - conversations: array of conversation objects from GET /chat/conversations
 *  - activeConversationId: currently open conversation (_id) or null
 *  - onSelect(conversation): load a conversation's messages into the chat pane
 *  - onNewChat(): clear the pane and start a fresh conversation
 *  - onDelete(conversation): delete a conversation
 *  - loadError: the conversation list failed to load (non-404)
 *  - onRetry(): refetch the conversation list
 */
const HistoryDisplay = ({
  conversations,
  activeConversationId,
  onSelect,
  onNewChat,
  onDelete,
  loadError = false,
  onRetry = () => {},
}) => {
  return (
    <aside className="chat-sidebar">
      <div className="chat-sidebar-header">
        <p className="sidebar-caption">Conversations</p>
        <button type="button" className="new-chat-button" onClick={onNewChat}>
          + New chat
        </button>
      </div>

      <div className="conversation-list">
        {loadError ? (
          <div className="conversation-error" role="alert">
            <p>Could not load conversations.</p>
            <button
              type="button"
              className="conversation-retry"
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        ) : !conversations || conversations.length === 0 ? (
          <div className="conversation-empty">
            <p>No conversations yet.</p>
            <p className="conversation-empty-hint">
              Start a new chat and it will show up here.
            </p>
          </div>
        ) : (
          conversations.map((conversation) => {
            const isActive = conversation._id === activeConversationId;
            // The row's click target is a real <button> — keyboard
            // activation (Enter/Space) then works without a custom
            // role="button" div wrapping another button (invalid nesting).
            return (
              <div
                key={conversation._id}
                className={`conversation-item ${isActive ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="conversation-item-main"
                  onClick={() => onSelect(conversation)}
                >
                  <span className="conversation-item-text">
                    <span className="conversation-title">
                      {conversationLabel(conversation)}
                    </span>
                    <span className="conversation-date">
                      {formatConversationDate(
                        conversation.updatedAt || conversation.createdAt
                      )}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="conversation-delete"
                  title="Delete conversation"
                  aria-label="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(conversation);
                  }}
                >
                  &times;
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};

export default React.memo(HistoryDisplay);
