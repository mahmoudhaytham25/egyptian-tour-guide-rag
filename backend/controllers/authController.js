const User = require('../models/user');
const jwt = require('jsonwebtoken');
const { sendVerificationEmail } = require('../services/emailService');
const bcrypt = require('bcryptjs');

exports.signup = async (req, res) => {
  const { email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (user) return res.status(409).json({ message: 'Email already in use.' });

    user = new User({ email, password });
    // Auto-verify for development
    user.verified = true;
    await user.save();

    // Skip email verification
    // const link = `http://localhost:3000/api/auth/verify/${token}`;
    // await sendVerificationEmail(email, link);

    res.status(201).json({ 
      message: 'Signup successful. Account automatically verified for development.',
      // Optionally return a token so they can login immediately
      token: jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' })
    });
  } catch (err) {
    res.status(500).json({ message: 'Signup failed.', error: err.message });
  }
};

exports.verify = async (req, res) => {
  const { token } = req.params;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) return res.status(400).json({ message: 'Invalid token.' });
    if (user.verified) return res.status(200).json({ message: 'Already verified.' });

    user.verified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    res.status(200).json({ message: 'Email verified! You can now log in.' });
  } catch (err) {
    res.status(400).json({ message: 'Verification failed.', error: err.message });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials.' });
    if (!user.verified) return res.status(401).json({ message: 'Please verify your email.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials.' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(200).json({ token, userId: user._id });
  } catch (err) {
    res.status(500).json({ message: 'Login failed.', error: err.message });
  }
};
