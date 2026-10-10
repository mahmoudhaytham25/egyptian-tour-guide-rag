import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import API from "../../services/api";
import "./Auth.css";
import AuthCard from "./AuthCard";
import authError from "./authError";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  // Already signed in — a valid session shouldn't see the login page.
  if (API.isAuthenticated()) {
    return <Navigate to="/chat" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    setError("");
    setSubmitting(true);
    try {
      await API.login({ email, password });
      navigate("/chat");
    } catch (err) {
      setError(authError(err, "Login failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Egyptian Tour Guide"
      sub="Ask questions about ancient Egypt and get answers grounded in real sources."
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <h2>Sign in</h2>
        <input
          className="auth-input"
          type="email"
          placeholder="Email"
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="auth-input"
          type="password"
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Login"}
        </button>
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <p className="auth-switch">
          Don't have an account? <Link to="/register">Register here</Link>
        </p>
      </form>
    </AuthCard>
  );
};

export default Login;
