// src/pages/Chat.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import ChatInterface from '../components/ChatInterface';
import '../../node_modules/bootstrap/dist/css/bootstrap.min.css';

const Chat = () => {
  return (
    <div className="chat-page">
          
      <main style={{ padding: '20px', height: '650px' }}>
        <ChatInterface />
      </main>
    </div>
  );
};

export default Chat;
