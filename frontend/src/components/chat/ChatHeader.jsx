import React from "react";
import icon from "../../Assets/Images/pharaoh-icon.png";

const ChatHeader = ({ onLogout }) => (
  <header className="chat-header">
    <div className="chat-header-brand">
      <img src={icon} alt="" className="chat-header-icon" />
      <div className="chat-header-text">
        <h2>Egyptian History Assistant</h2>
        <p>Powered by RAG Technology</p>
      </div>
    </div>
    <div className="chat-header-actions">
      {/* Plain <a> — ChatInterface tests render without a Router. */}
      <a className="chat-nav-link" href="/documents">
        Knowledge Base
      </a>
      <button type="button" className="logout-button" onClick={onLogout}>
        Logout
      </button>
    </div>
  </header>
);

export default ChatHeader;
