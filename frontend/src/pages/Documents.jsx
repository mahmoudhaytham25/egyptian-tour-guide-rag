// src/pages/Documents.jsx
import React, { useState } from 'react';
import api from '../services/api';
import DocumentUploader from '../components/DocumentUploader';
import DocumentManager from '../components/DocumentManager';
import pyramids from '../Assets/Images/Pyramids.png';

// Knowledge Base page (mounted at /documents): PDF upload + indexing that
// feeds the RAG pipeline. Reached via the chat header's "Knowledge Base" link.
const Documents = () => {
  const [refreshDocuments, setRefreshDocuments] = useState(0);

  const handleDocumentUploaded = () => {
    // Trigger a refresh of the document list when a new document is uploaded
    setRefreshDocuments(prev => prev + 1);
  };

  const handleLogout = () => {
    api.logout();
    window.location.href = '/';
  };

  return (
    <div className="documents-page">
      <img src={pyramids} alt="" className="imgCover" />
      <div className="bg-overlay" aria-hidden="true" />

      <nav className="page-nav">
        <a href="/chat" className="page-nav-back">← Back to chat</a>
        <button type="button" className="page-nav-button" onClick={handleLogout}>
          Logout
        </button>
      </nav>

      <section className="documents-section">
        <div className="documents-section-header">
          <h2>Knowledge Base</h2>
          <p>Upload PDF documents to expand what the assistant can answer from.</p>
        </div>
        <DocumentUploader onDocumentUploaded={handleDocumentUploaded} />
        <DocumentManager key={refreshDocuments} />
      </section>
    </div>
  );
};

export default Documents;
