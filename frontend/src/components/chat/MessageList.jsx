import { memo } from "react";
import icon from "../../Assets/Images/pharaoh-icon.png";
import ChatMessage from "./ChatMessage";
import { messageKey } from "./messageUtils";
import { STARTER_QUESTIONS } from "./chatData";

// Scrollable message pane: welcome/loading empty states, committed messages,
// the typing indicator while awaiting a reply, and the live streaming bubble.
const MessageList = ({
  messages,
  isLoadingHistory,
  streaming,
  currentStreamedText,
  isBusy,
  onSuggestionClick,
  messagesEndRef,
}) => (
  <div className="chat-messages" role="log" aria-live="polite">
    {messages.length === 0 && isLoadingHistory && (
      <div className="welcome-message">
        <p>Loading conversation…</p>
      </div>
    )}

    {messages.length === 0 && !isLoadingHistory && (
      <div className="welcome-message">
        <img src={icon} alt="" className="welcome-icon" />
        <h3>Ahoy, explorer!</h3>
        <p>
          Ask me anything about ancient Egypt — pharaohs, pyramids, temples,
          hieroglyphs and more.
        </p>
        <div className="starter-chips">
          {STARTER_QUESTIONS.map((question) => (
            <button
              key={question}
              type="button"
              className="suggestion-button"
              disabled={isBusy}
              onClick={() => onSuggestionClick(question)}
            >
              {question}
            </button>
          ))}
        </div>
      </div>
    )}

    {messages.map((msg, index) => (
      <ChatMessage
        key={messageKey(msg, index)}
        msg={msg}
        isBusy={isBusy}
        onSuggestionClick={onSuggestionClick}
      />
    ))}

    {isBusy && !streaming && (
      <div className="message-wrapper bot-wrapper">
        <div className="avatar bot-avatar">
          <img src={icon} alt="" />
        </div>
        <div className="message bot">
          <div className="typing-indicator" aria-label="Assistant is typing">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    )}

    {streaming && (
      <div className="message-wrapper bot-wrapper">
        <div className="avatar bot-avatar">
          <img src={icon} alt="" />
        </div>
        <div className="message bot">
          <div className="message-content">{currentStreamedText}</div>
        </div>
      </div>
    )}

    <div ref={messagesEndRef} />
  </div>
);

// Memoized so keystrokes in the composer don't re-render the message pane
// when nothing it displays has changed.
export default memo(MessageList);
