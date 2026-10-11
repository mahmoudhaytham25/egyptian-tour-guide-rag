import { memo, useEffect } from "react";

const MAX_TEXTAREA_HEIGHT = 132; // ~5 lines before the field starts scrolling

const autoGrow = (el) => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
};

// Composer: auto-growing textarea (Enter sends, Shift+Enter newlines) plus
// the send button and the keyboard hint.
const ChatInput = ({ value, onChange, onKeyDown, onSend, disabled, inputRef }) => {
  // Collapse the field back to one row after a send clears it.
  useEffect(() => {
    if (value === "") autoGrow(inputRef?.current);
  }, [value, inputRef]);

  const handleChange = (e) => {
    onChange(e.target.value);
    autoGrow(e.target);
  };

  return (
    <div className="chat-input-container">
      <div className="chat-input-wrapper">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Type your message..."
          aria-label="Type your message"
          value={value}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          rows={1}
          // Matches the backend's MAX_QUERY_LENGTH — the field can never
          // grow past the 'Question is too long' 400 (the server-side
          // guard stays the real boundary).
          maxLength={2000}
        />
        <button
          type="button"
          className="send-button"
          onClick={onSend}
          disabled={disabled}
          aria-label="Send message"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 24 24"
            width="18"
            height="18"
          >
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
          </svg>
        </button>
      </div>
      <div className="input-footer">
        <div className="input-hint">
          Press Enter to send, Shift+Enter for a new line
        </div>
      </div>
    </div>
  );
};

export default memo(ChatInput);
