// src/pages/Chat.jsx
import ChatInterface from '../components/ChatInterface';

// Authenticated landing page (mounted at /chat): the chat interface is the
// whole page. Knowledge-base document management lives at /documents.
const Chat = () => {
  return (
    <main className="chat-page">
      <ChatInterface />
    </main>
  );
};

export default Chat;
