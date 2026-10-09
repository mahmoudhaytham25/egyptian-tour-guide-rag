// src/components/auth/Register.jsx
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../../services/api";          // <- must expose signup / chat helpers
import logo from "../../Assets/Images/FacultyLogo.png";

const Register = () => {
  const navigate = useNavigate();

  /* form state */
  const [fullName, setFullName]       = useState("");
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender]           = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  /* simple confirm-password check */
  const confirmPasswordEl = document.getElementById("confirmPassword");
  const confirmPasswordFun = () => {
    if (confirmPasswordEl?.value === password) {
      confirmPasswordEl.classList.remove("is-invalid");
      confirmPasswordEl.classList.add("is-valid");
    } else {
      confirmPasswordEl?.classList.add("is-invalid");
    }
  };

  /* main submit */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(""); // Clear previous error messages

    // Basic validation
    if (!fullName || !email || !password || !dateOfBirth || !gender || !contactInfo) {
      setErrorMessage("Please fill in all required fields.");
      return;
    }

    // Check if passwords match
    if (confirmPasswordEl?.value !== password) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    try {
      /* 1. sign the user up  */
      const { token } = await API.signup({ 
        fullName, 
        email, 
        password, 
        dateOfBirth, 
        gender, 
        contactInfo 
      });
      
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
              type="text"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={{ marginTop: "-8rem" }}
              required
            />
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
              className="form-control"
              type="password"
              placeholder="Confirm Password"
              onChange={confirmPasswordFun}
              required
            />
            <input
              className="form-control"
              type="date"
              placeholder="Date of Birth"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              required
            />
            <select
              className="form-select"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              required
            >
              <option value="">Select Gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
            <input
              className="form-control"
              type="text"
              placeholder="Contact Info"
              value={contactInfo}
              onChange={(e) => setContactInfo(e.target.value)}
              required
            />
            <button className="btn btn-primary m-2" type="submit">
              Register
            </button>
            <p className="mt-3">
              Already have an account? <Link to="/login">Login here</Link>
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
