// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Chat from './pages/Chat';
import Login from './components/Auth/Login'
import Signup from './components/Auth/Register'
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/register" element={<Signup />} />
          <Route path="/chat" element={<Chat />} /> 
          <Route path="/home" element={<Home />} /> 
        </Routes>
      </div>
    </Router>
  );
}

export default App;
