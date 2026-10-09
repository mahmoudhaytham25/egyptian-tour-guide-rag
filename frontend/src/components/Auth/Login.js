import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom"; // Import useNavigate
import API from "../../services/api";
import "../../../node_modules/bootstrap/dist/css/bootstrap.min.css";
import "./LoginStyle.css";
import logo from "../../Assets/Images/FacultyLogo.png";
// import BackButton from "../smallComponents/backButton";
// import Navbar from "../navbar/navbar";
const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate(); // Use React Router navigation
 
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      console.log("Attempting login with email:", email);
      const res = await API.login({ email, password }); 
      console.log("Backend response: ", res);
      console.log("Login successful for email:", email);
      
      // Navigate to home page using React Router
      navigate("/home");

    } catch (err) {
      console.error("Login error:", err);
      setError("Invalid credentials");
    }
  };
  const forgetPasswrod = () => {
    // write code to contact backend in order to update the password of a user
  };

  return (
    <>
      {/* <Link to="/">
        <i className="fa-solid fa-angle-left"></i>
      </Link> */}
      {/* <BackButton /> */}
      <div className="container h-100">
        <div className="w-100">
          <form
            onSubmit={handleSubmit}
            className="container d-flex flex-column justify-content-center align-items-center LoginForm"
          >
            <h1>Sign in</h1>
            <input
              className=" form-control "
              type="email"
              placeholder="Email"
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className=" form-control "
              type="password"
              placeholder="Password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="loginBtn">
              <button type="submit" className="btn btn-primary m-2">
                Login
              </button>
              <button
                type="submit"
                className="btn btn-secondary mb-1"
                onClick={forgetPasswrod}
                style={{fontSize: "small"}}
              >
                Forget Password
              </button>
              {error && <p>{error}</p>}
              <p id="registerLink">
                Don't have an account?
                <Link to="/register"> Register here</Link>{" "}
                {/* Link to the Register page */}
              </p>
            </div>
          </form>
        </div>
        <div
          className="d-flex justify-content-center align-items-center"
          id="imgDiv"
        >
          <img src={logo} alt="" className="loginImg" style={{width:"150%"}}/>
        </div>
      </div>
    </>
  );
};

export default Login;