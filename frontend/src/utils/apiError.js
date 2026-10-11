/**
 * Map an axios-style error to a user-facing message: prefer the
 * server's `data.message`, then distinguish "request sent, no response"
 * (network failure) from everything else, which falls back to the
 * caller-supplied generic message.
 */
const apiError = (err, fallback) =>
  err.response?.data?.message ||
  (err.request
    ? "Network error. Please check your connection and try again."
    : fallback);

export default apiError;
