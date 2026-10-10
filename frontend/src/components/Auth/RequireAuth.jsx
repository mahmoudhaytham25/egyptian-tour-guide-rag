import React from "react";
import { Navigate } from "react-router-dom";
import api from "../../services/api";

/**
 * Route guard for authenticated pages. Requires a non-expired JWT
 * (see api.isAuthenticated); otherwise clears stale auth state and
 * redirects to the login page.
 */
const RequireAuth = ({ children }) => {
  if (!api.isAuthenticated()) {
    api.logout(); // drop stale/expired token and related state
    return <Navigate to="/" replace />;
  }
  return children;
};

export default RequireAuth;
