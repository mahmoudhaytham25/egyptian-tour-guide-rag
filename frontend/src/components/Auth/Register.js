// src/components/auth/Register.jsx
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../../services/api";          // <- must expose signup / chat helpers
import "../../../node_modules/bootstrap/dist/css/bootstrap.min.css";
import "./LoginStyle.css";
import logo from "../../Assets/Images/FacultyLogo.png";

const Register = () => {
  const navigate = useNavigate();

  /* form state — the backend User model only stores email + password */
  const [email, setEmail]                 = useState("");
  const [password, setPassword]           = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  /* live confirm-password feedback (Bootstrap is-valid/is-invalid classes) */
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
    setErrorMessage(""); // Clear previous error messages

    // Basic validation
    if (!email || !password) {
      setErrorMessage("Please fill in all required fields.");
      return;
    }

    // Check if passwords match
    if (!passwordsMatch) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    try {
      /* 1. sign the user up — backend only reads { email, password } */
      const { token } = await API.signup({ email, password });
      
      // store token (adapt to your auth flow)
      localStorage.setItem("authToken", token);

      /* 2. set auth header for subsequent calls */
      API.setAuthToken(token);

      /* 3. try to fetch existing conversations */
      let conversationId = null;
      const convList = await API.getConversations();   // GET /chat/conversations
      if (Array.isArray(convList) && convList.length) {
        conversationId = convList[0]._id;              // pick the first active one
      } else {
        /* 4. create a conversation because none exist */
        const newConv = await API.createConversation({
          title: "My first conversation"
        });                                            // POST /chat/conversations
        conversationId = newConv._id;
      }

      /* 5. persist the id for later queries */
      localStorage.setItem("conversationId", conversationId);

      /* 6. redirect */
      navigate("/");
    } catch (err) {
      console.error("Registration flow failed:", err);
      
      // Handle specific error cases
      if (err.response) {
        const { status, data } = err.response;
        
        switch (status) {
          case 409:
            setErrorMessage("An account with this email already exists. Please try logging in instead.");
            break;
          case 400:
            setErrorMessage(data.message || "Invalid registration data. Please check your information.");
            break;
          case 500:
            setErrorMessage("Server error. Please try again later.");
            break;
          default:
            setErrorMessage("Registration failed. Please try again.");
        }
      } else if (err.request) {
        setErrorMessage("Network error. Please check your connection and try again.");
      } else {
        setErrorMessage("Registration failed. Please try again.");
      }
    }
  };

  return (
    <>
      <div className="container">
        <div className="w-100">
          <form
            onSubmit={handleSubmit}
            className="container d-flex flex-column justify-content-center align-items-center signupForm"
            style={{ marginTop: "-8rem" }}
          >
            {errorMessage && (
              <div className="alert alert-danger w-100" role="alert">
                {errorMessage}
              </div>
            )}
            <input
              className="form-control"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="form-control"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <input
              id="confirmPassword"
              className={`form-control ${confirmClass}`}
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {confirmTouched && !passwordsMatch && (
              <p className="text-danger" style={{ fontSize: "0.8rem", marginTop: "4px" }}>
                Passwords do not match.
              </p>
            )}
            <button className="btn btn-primary m-2" type="submit">
              Register
            </button>
            <p className="mt-3">
              Already have an account? <Link to="/">Login here</Link>
            </p>
          </form>
        </div>
        <div
          className="d-flex justify-content-center align-items-center"
          id="imgDiv"
        >
          <img src={logo} alt="" style={{ width: "150%" }} />
        </div>
      </div>
    </>
  );
};

export default Register;
