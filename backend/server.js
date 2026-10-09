const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const connectDB = require('./config/database');
require('dotenv').config(); // This must be at the top to load environment variables

// Import routes
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3001;

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
    'http://localhost:8080',
    'http://localhost:8081'
  ],
  credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Create data directory if it doesn't exist
const fs = require('fs');
const dataDir = path.join(__dirname, '../model-server/data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Serve static files if needed
app.use(express.static(path.join(__dirname, 'public')));

// Mount routes
app.use('/api/auth', authRoutes); // Authentication routes
app.use('/api/chat', chatRoutes); // Chat history routes (protected by auth middleware)
app.use('/api', apiRoutes);       // RAG functionality routes

// Basic route for testing
app.get('/', (req, res) => {
  res.send('Egyptian History RAG API is running');
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'production' ? {} : err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`- Auth routes: http://localhost:${PORT}/api/auth`);
  console.log(`- Chat routes: http://localhost:${PORT}/api/chat`);
  console.log(`- RAG routes: http://localhost:${PORT}/api`);
});

module.exports = app;
