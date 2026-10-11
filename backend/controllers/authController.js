const User = require('../models/user');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { HttpError } = require('../middleware/errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
// bcrypt only uses the first 72 bytes — a longer password would silently
// truncate, so any login sharing the 72-byte prefix would match.
const MAX_PASSWORD_BYTES = 72;
const TOKEN_TTL = '12h';
// Compared against when the account doesn't exist so login timing doesn't
// reveal whether an email is registered.
const DUMMY_HASH = bcrypt.hashSync('dummy', 10);

function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function signToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

exports.signup = async (req, res) => {
  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const { password } = body;

  if (!EMAIL_RE.test(email)) {
    throw new HttpError(400, 'A valid email is required');
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new HttpError(400, `Password must be at most ${MAX_PASSWORD_BYTES} bytes`);
  }

  const existing = await User.findOne({ email });
  if (existing) {
    throw new HttpError(409, 'Email already in use.');
  }

  const user = new User({ email, password });
  // Accounts are auto-verified; email verification was removed along with
  // the mailer dependency — the `verified` flag remains for existing users.
  user.verified = true;
  try {
    await user.save();
  } catch (err) {
    // Unique-index race: another signup for this email won between the
    // findOne above and this insert.
    if (err.code === 11000) {
      throw new HttpError(409, 'Email already in use.');
    }
    throw err;
  }

  res.status(201).json({
    message: 'Signup successful.',
    token: signToken(user)
  });
};

exports.login = async (req, res) => {
  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const { password } = body;

  if (!EMAIL_RE.test(email)) {
    throw new HttpError(400, 'A valid email is required');
  }
  if (typeof password !== 'string' || !password) {
    throw new HttpError(400, 'Password is required');
  }

  const user = await User.findOne({ email });
  // Always run a bcrypt compare — a missing account must cost the same as a
  // wrong password so the response time can't reveal account existence.
  const isMatch = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !isMatch) {
    throw new HttpError(401, 'Invalid credentials.');
  }
  if (!user.verified) {
    throw new HttpError(401, 'Please verify your email.');
  }

  res.status(200).json({ token: signToken(user), userId: user._id });
};
