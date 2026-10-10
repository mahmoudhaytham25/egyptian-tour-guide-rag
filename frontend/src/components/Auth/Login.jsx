import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../../services/api";
import "./LoginStyle.css";
import logo from "../../Assets/Images/FacultyLogo.png";

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
    <>
      <div className="container h-100">
        <div className="w-100">
          <form
            onSubmit={handleSubmit}
            className="container d-flex flex-column justify-content-center align-items-center LoginForm"
          >
            <h1>Sign in</h1>
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
            <div className="loginBtn">
              <button
                type="submit"
                className="btn btn-primary m-2"
                disabled={submitting}
              >
                {submitting ? "Signing in..." : "Login"}
              </button>
              {error && (
                <div className="alert alert-danger" role="alert">
                  {error}
                </div>
              )}
              <p id="registerLink">
                Don't have an account?
                <Link to="/register"> Register here</Link>
              </p>
            </div>
          </form>
        </div>
        <div
          className="d-flex justify-content-center align-items-center"
          id="imgDiv"
        >
          <img src={logo} alt="" className="loginImg" style={{ width: "150%" }} />
        </div>
      </div>
    </>
  );
};

export default Login;
