const User = require('../models/user');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { HttpError } = require('../middleware/errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const TOKEN_TTL = '12h';

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

  const existing = await User.findOne({ email });
  if (existing) {
    throw new HttpError(409, 'Email already in use.');
  }

  const user = new User({ email, password });
  // Accounts are auto-verified; email verification was removed along with
  // the mailer dependency — the `verified` flag remains for existing users.
  user.verified = true;
  await user.save();

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
  if (!user) {
    throw new HttpError(401, 'Invalid credentials.');
  }
  if (!user.verified) {
    throw new HttpError(401, 'Please verify your email.');
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new HttpError(401, 'Invalid credentials.');
  }

  res.status(200).json({ token: signToken(user), userId: user._id });
};
