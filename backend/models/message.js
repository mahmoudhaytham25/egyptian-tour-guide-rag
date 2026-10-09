const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  // Optional: add metadata for RAG sources if needed
  metadata: { type: Object, default: {} }
});

module.exports = mongoose.model('Message', messageSchema);