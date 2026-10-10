import { memo } from "react";
import icon from "../../Assets/Images/pharaoh-icon.png";
import { formatMessageTime } from "./messageUtils";

// One chat row: avatar + bubble. Suggestion messages also render their chips;
// error messages reuse the bot layout with a red-tinted bubble.
const ChatMessage = ({ msg, isBusy, onSuggestionClick }) => {
  const isUser = msg.type === "user";
  const time = formatMessageTime(msg.timestamp);

  return (
    <div
      className={`message-wrapper ${isUser ? "user-wrapper" : "bot-wrapper"}`}
    >
      {!isUser && (
        <div className="avatar bot-avatar">
          <img src={icon} alt="" />
        </div>
      )}

      <div className={`message ${msg.type}`}>
        <div className="message-content">{msg.content}</div>

        {msg.type === "suggestions" && msg.suggestions && (
          <div className="suggestions-container">
            {msg.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="suggestion-button"
                disabled={isBusy}
                onClick={() => onSuggestionClick(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {time && <div className="message-time">{time}</div>}
      </div>

      {isUser && <div className="avatar user-avatar">You</div>}
    </div>
  );
};

// Memoized: every streaming tick and keystroke re-renders the list, so
// committed rows skip the render when their props are unchanged.
export default memo(ChatMessage);
