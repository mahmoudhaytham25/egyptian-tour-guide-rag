// src/pages/Home.jsx
import React, { useState } from 'react';
import DocumentUploader from '../components/DocumentUploader';
import DocumentManager from '../components/DocumentManager';
import Chat from './Chat';

// Authenticated landing page (mounted at /chat): the chat interface plus the
// knowledge-base document management that feeds the RAG pipeline.
const Home = () => {
  const [refreshDocuments, setRefreshDocuments] = useState(0);

  const handleDocumentUploaded = () => {
    // Trigger a refresh of the document list when a new document is uploaded
    setRefreshDocuments(prev => prev + 1);
  };

  return (
    <div className="home-container">
      <Chat />

      <section className="documents-section">
        <h2>Knowledge Base</h2>
        <DocumentUploader onDocumentUploaded={handleDocumentUploaded} />
        <DocumentManager key={refreshDocuments} />
      </section>
    </div>
  );
};

export default Home;
