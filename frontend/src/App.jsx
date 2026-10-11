// src/App.jsx
import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Auth/Login'
import Signup from './components/Auth/Register'
import RequireAuth from './components/Auth/RequireAuth';
import './App.css';

// The authenticated pages pull in the whole chat/documents stack — split
// them out of the initial bundle so the login screen stays light.
const Chat = lazy(() => import('./pages/Chat'));
const Documents = lazy(() => import('./pages/Documents'));

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
                <Suspense fallback={null}>
                  <Chat />
                </Suspense>
              </RequireAuth>
            }
          />
          {/* Knowledge-base document management (upload + indexing). */}
          <Route
            path="/documents"
            element={
              <RequireAuth>
                <Suspense fallback={null}>
                  <Documents />
                </Suspense>
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
