const path = require('path');

// A safe document basename: at least one alphanumeric, only
// letters/digits/dot/underscore/dash — no path separators or spaces.
const SAFE_BASENAME_RE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]+$/;

// Strict validation for caller-supplied document names (index + query):
// the value must be exactly its own basename and match the safe charset —
// anything else is rejected rather than rewritten.
function isSafeBasename(name) {
  const str = String(name);
  return path.basename(str) === str && SAFE_BASENAME_RE.test(str);
}

// Sanitizing validation for upload filenames: unsafe characters are
// rewritten to '_' instead of rejecting, matching the model server's
// filename rules. Returns the safe name, or null if it can't be a PDF.
function sanitizeUploadName(originalname) {
  const base = path.basename(String(originalname || ''));
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return safe.toLowerCase().endsWith('.pdf') && safe.length > 4 ? safe : null;
}

module.exports = { SAFE_BASENAME_RE, isSafeBasename, sanitizeUploadName };
