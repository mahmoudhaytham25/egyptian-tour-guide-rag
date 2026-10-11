import HistoryDisplay from "./HistoryDisplay";
import useChat from "./chat/useChat";
import ChatHeader from "./chat/ChatHeader";
import MessageList from "./chat/MessageList";
import ChatInput from "./chat/ChatInput";
import "./chat/chat.css";

// Chat shell: the themed backdrop plus the sidebar/pane layout. All state and
// effects live in useChat; the pieces under chat/ are presentational.
const ChatInterface = () => {
  const chat = useChat();

  return (
    <>
      <img
        src={chat.backgroundImage}
        alt=""
        className={`imgCover ${chat.fade ? "fade-out" : ""}`}
      />
      <div className="bg-overlay" aria-hidden="true" />

      <div className="chat-layout">
        <HistoryDisplay
          conversations={chat.conversations}
          activeConversationId={chat.activeConversationId}
          onSelect={chat.handleSelectConversation}
          onNewChat={chat.handleNewChat}
          onDelete={chat.handleDeleteConversation}
          loadError={chat.conversationsError}
          onRetry={chat.retryLoadConversations}
        />

        <div className="chat-container">
          <ChatHeader
            onLogout={chat.handleLogout}
            documents={chat.documents}
            selectedDocument={chat.selectedDocument}
            onSelectDocument={chat.setSelectedDocument}
            onRefreshDocuments={chat.refreshDocuments}
          />

          <MessageList
            messages={chat.messages}
            isLoadingHistory={chat.isLoadingHistory}
            streaming={chat.streaming}
            currentStreamedText={chat.currentStreamedText}
            isBusy={chat.isBusy}
            onSuggestionClick={chat.sendQuestion}
            messagesEndRef={chat.messagesEndRef}
          />

          <ChatInput
            value={chat.input}
            onChange={chat.setInput}
            onKeyDown={chat.handleKeyPress}
            onSend={chat.handleSend}
            disabled={
              !chat.input.trim() || chat.isBusy || chat.isLoadingHistory
            }
            inputRef={chat.inputRef}
          />
        </div>
      </div>
    </>
  );
};

export default ChatInterface;
