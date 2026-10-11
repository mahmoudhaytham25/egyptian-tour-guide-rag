// Expected client errors thrown from handlers; anything else that reaches
// errorHandler becomes a logged, generic 500 with no internals leaked.
// All error responses use the { message } shape.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Pull a display-safe detail string out of a failed model-server call —
// the upstream JSON's error/message field, else axios's own message.
function modelServerErrorDetail(error) {
  return (
    (error.response && error.response.data &&
      (error.response.data.error || error.response.data.message)) ||
    error.message
  );
}

/**
 * Map a failed axios call to the model server onto an HttpError:
 *  - axios timeout (ECONNABORTED / "timeout" message) → 504 timeoutMessage
 *  - an upstream status listed in allowedClientStatuses → passed through
 *    verbatim, carrying the detail from getDetail(error)
 *  - no response at all (connection refused, DNS, …) → 502 "unreachable"
 *  - anything else → 502 with message formatFailure(getDetail(error))
 *
 * getDetail / formatFailure let each call site keep its own surfacing
 * policy (which upstream fields are trusted, and the fallback wording).
 */
function toModelServerHttpError(error, {
  allowedClientStatuses = [],
  timeoutMessage = 'Model server timed out',
  getDetail = modelServerErrorDetail,
  formatFailure = (detail) => `Model server request failed: ${detail}`
} = {}) {
  // Axios timeout (ECONNABORTED, no response) — without this it would
  // masquerade as a 502 "unreachable".
  if (error.code === 'ECONNABORTED' ||
      (error.message && error.message.toLowerCase().includes('timeout'))) {
    return new HttpError(504, timeoutMessage);
  }
  const status = error.response && error.response.status;
  // Only whitelisted client errors are safe to pass through — an upstream
  // 401/403 (bad INTERNAL_API_TOKEN) would read to the browser as the
  // user's own session expiring and force a logout.
  if (status !== undefined && allowedClientStatuses.includes(status)) {
    return new HttpError(status, String(getDetail(error)));
  }
  if (!error.response) {
    return new HttpError(502, 'Model server is unreachable');
  }
  return new HttpError(502, formatFailure(getDetail(error), error));
}

const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  // HttpError is always deliberate — even ≥500 statuses like 502/504 carry a
  // safe, hand-written message.
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message });
  }
  // Framework-level errors (e.g. malformed-JSON body parse) carry a
  // status/statusCode — any explicit <500 status is a safe client error.
  const status = err.status || err.statusCode;
  if (status && status < 500) {
    return res.status(status).json({ message: err.message });
  }
  // A malformed :id param (or filter value) that slipped through validation.
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid identifier' });
  }
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
};

module.exports = { HttpError, errorHandler, toModelServerHttpError };
