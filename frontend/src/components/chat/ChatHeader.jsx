import { memo } from "react";
import { Link } from "react-router-dom";
import DocumentSelector from "./DocumentSelector";
import icon from "../../Assets/Images/pharaoh-icon.png";

const ChatHeader = ({
  onLogout,
  documents,
  selectedDocument,
  onSelectDocument,
  onRefreshDocuments,
}) => (
  <header className="chat-header">
    <div className="chat-header-brand">
      <img src={icon} alt="" className="chat-header-icon" />
      <div className="chat-header-text">
        <h2>Egyptian History Assistant</h2>
        <p>Powered by RAG Technology</p>
      </div>
    </div>
    <div className="chat-header-actions">
      <DocumentSelector
        documents={documents}
        value={selectedDocument}
        onChange={onSelectDocument}
        onRefresh={onRefreshDocuments}
      />
      <Link className="chat-nav-link" to="/documents">
        Knowledge Base
      </Link>
      <button type="button" className="logout-button" onClick={onLogout}>
        Logout
      </button>
    </div>
  </header>
);

export default memo(ChatHeader);
