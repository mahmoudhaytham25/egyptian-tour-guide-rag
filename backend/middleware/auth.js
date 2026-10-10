const jwt = require('jsonwebtoken');
const User = require('../models/user');
const { HttpError } = require('./errors');

module.exports = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpError(401, 'Authorization denied, no token provided');
    }

    // Extract token
    const token = authHeader.slice('Bearer '.length).trim();

    // Verify token — pin the algorithm so a token signed with a different
    // algorithm can't be substituted.
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256']
    });

    // Find user by ID (token may be valid for a since-deleted account).
    // Fresh DB hit every request, but only the email column is hydrated —
    // the password hash never enters the request lifecycle.
    const user = await User.findById(decoded.id).select('email').lean();
    if (!user) {
      throw new HttpError(401, 'User not found');
    }

    // Attach only the fields downstream code needs — never the full document
    // (which would carry the password hash around the request lifecycle).
    req.user = { id: user._id, email: user.email };
    req.userId = user._id;

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new HttpError(401, 'Token expired'));
    }
    if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
      return next(new HttpError(401, 'Invalid token'));
    }
    next(err);
  }
};
