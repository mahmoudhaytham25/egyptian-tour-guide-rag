// src/pages/Home.jsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import DocumentUploader from '../components/DocumentUploader';
import DocumentManager from '../components/DocumentManager';
import '../../node_modules/bootstrap/dist/css/bootstrap.min.css';
import Chat from './Chat';


const Home = () => {
  const [refreshDocuments, setRefreshDocuments] = useState(0);

  const handleDocumentUploaded = () => {
    // Trigger a refresh of the document list when a new document is uploaded
    setRefreshDocuments(prev => prev + 1);
  };

  return (
    <div className="home-container">
      
      {/* <h1>Egyptian History RAG System</h1>
      
      <section className="upload-section">
        <DocumentUploader onDocumentUploaded={handleDocumentUploaded} />
      </section>
      
      <section className="documents-section">
        <DocumentManager key={refreshDocuments} />
      </section>
      
      <section className="start-chat">
        <Link to="/chat" className="chat-button">
          Start Chatting About Egyptian History
        </Link>
      </section> */}
      <Chat />

    </div>
  );
};

export default Home;
