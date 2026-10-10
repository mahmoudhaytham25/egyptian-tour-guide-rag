const mongoose = require('mongoose');

// Strip $-prefixed keys from query filters so a crafted request body can't
// smuggle query operators ({ $gt: '' } etc.) into find()/findOne() calls.
mongoose.set('sanitizeFilter', true);

const connectDB = async () => {
  try {
    // MONGODB_URI is required — server.js validates the environment before
    // this runs, so there is intentionally no localhost fallback here.
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
