import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import api from "../../services/api";

/**
 * Route guard for authenticated pages. Requires a non-expired JWT
 * (see api.isAuthenticated); otherwise clears stale auth state and
 * redirects to the login page.
 */
const RequireAuth = ({ children }) => {
  const authed = api.isAuthenticated();

  // localStorage cleanup is a side effect — keep it out of render so it
  // isn't double-invoked under StrictMode.
  useEffect(() => {
    if (!authed) {
      api.logout(); // drop stale/expired token and related state
    }
  }, [authed]);

  if (!authed) {
    return <Navigate to="/" replace />;
  }
  return children;
};

export default RequireAuth;
