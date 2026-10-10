// src/pages/Home.jsx
import React from 'react';
import Chat from './Chat';

// Authenticated landing page (mounted at /chat): just the chat interface.
// Knowledge-base document management lives at /documents.
const Home = () => {
  return (
    <div className="home-container">
      <Chat />
    </div>
  );
};

export default Home;
