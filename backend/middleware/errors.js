// Expected client errors thrown from handlers; anything else that reaches
// errorHandler becomes a logged, generic 500 with no internals leaked.
// All error responses use the { message } shape.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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

module.exports = { HttpError, errorHandler };
