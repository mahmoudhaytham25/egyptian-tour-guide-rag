// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Documents from './pages/Documents';
import Login from './components/Auth/Login'
import Signup from './components/Auth/Register'
import RequireAuth from './components/Auth/RequireAuth';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/register" element={<Signup />} />
          {/* /chat is the canonical authenticated page (chat + knowledge base). */}
          <Route
            path="/chat"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
          {/* Knowledge-base document management (upload + indexing). */}
          <Route
            path="/documents"
            element={
              <RequireAuth>
                <Documents />
              </RequireAuth>
            }
          />
          {/* Legacy duplicate route — kept as a redirect so old links work. */}
          <Route path="/home" element={<Navigate to="/chat" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
