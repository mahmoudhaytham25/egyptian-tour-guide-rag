// src/components/auth/Register.jsx
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../../services/api";
import "./Auth.css";
import icon from "../../Assets/Images/pharaoh-icon.png";

const MIN_PASSWORD_LENGTH = 8;

const Register = () => {
  const navigate = useNavigate();

  /* form state — the backend User model only stores email + password */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /* live confirm-password feedback */
  const confirmTouched = confirmPassword.length > 0;
  const passwordsMatch = confirmPassword === password;
  const confirmClass = !confirmTouched
    ? ""
    : passwordsMatch
      ? "is-valid"
      : "is-invalid";

  /* main submit */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMessage("");

    // Basic validation (mirrors the backend rules)
    if (!email || !password) {
      setErrorMessage("Please fill in all required fields.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (!passwordsMatch) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const { token } = await API.signup({ email, password });

      if (!token) {
        setErrorMessage(
          "Account created, but no session was returned. Please log in."
        );
        return;
      }
      API.setAuthToken(token);

      /* Conversations are created lazily on the first chat message,
         so there is nothing else to provision — go straight to chat. */
      navigate("/chat");
    } catch (err) {
      setErrorMessage(
        err.response?.data?.message ||
          (err.request
            ? "Network error. Please check your connection and try again."
            : "Registration failed. Please try again.")
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
            Create an account to start exploring ancient Egypt with your AI
            guide.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form signupForm">
          <h2>Create your account</h2>
          {errorMessage && (
            <div className="auth-error" role="alert">
              {errorMessage}
            </div>
          )}
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
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <input
            id="confirmPassword"
            className={`auth-input ${confirmClass}`}
            type="password"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          {confirmTouched && !passwordsMatch && (
            <p className="auth-field-error">Passwords do not match.</p>
          )}
          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? "Registering..." : "Register"}
          </button>
          <p className="auth-switch">
            Already have an account? <Link to="/">Login here</Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default Register;
