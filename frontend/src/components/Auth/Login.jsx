import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../../services/api";
import "./Auth.css";
import icon from "../../Assets/Images/pharaoh-icon.png";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    setError("");
    setSubmitting(true);
    try {
      await API.login({ email, password });
      navigate("/chat");
    } catch (err) {
      setError(
        err.response?.data?.message || "Network error. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={icon} alt="" className="auth-brand-icon" />
          <h1 className="auth-brand-title">Egyptian Tour Guide</h1>
          <p className="auth-brand-sub">
            Ask questions about ancient Egypt and get answers grounded in real
            sources.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <h2>Sign in</h2>
          <input
            className="auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Password"
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
      </div>
    </div>
  );
};

export default Login;
