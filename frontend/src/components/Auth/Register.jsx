// src/components/auth/Register.jsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../../services/api";
import "./Auth.css";
import AuthCard from "./AuthCard";
import authError from "./authError";

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
      setErrorMessage(authError(err, "Registration failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Egyptian Tour Guide"
      sub="Create an account to start exploring ancient Egypt with your AI guide."
    >
      {/* `signupForm` has no CSS rule — it's a hook so tests can grab the
          form element and submit it programmatically (bypassing native
          constraint validation). */}
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
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        <input
          id="confirmPassword"
          className={`auth-input ${confirmClass}`}
          type="password"
          placeholder="Confirm Password"
          aria-label="Confirm Password"
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
    </AuthCard>
  );
};

export default Register;
