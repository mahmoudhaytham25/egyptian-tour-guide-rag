// Shared sign-out used by the chat header, the documents page, and the
// multi-tab logout handler: clear the local session, then bounce to the
// login page (matches the 401 interceptor's window.location.assign).
import api from "../services/api";

export const logout = () => {
  api.logout();
  window.location.assign("/");
};

export default logout;
