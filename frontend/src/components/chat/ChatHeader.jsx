import { Link } from "react-router-dom";
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
      <Link className="chat-nav-link" to="/documents">
        Knowledge Base
      </Link>
      <button type="button" className="logout-button" onClick={onLogout}>
        Logout
      </button>
    </div>
  </header>
);

export default ChatHeader;
