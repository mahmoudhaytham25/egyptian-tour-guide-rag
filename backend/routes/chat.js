const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const auth = require('../middleware/auth');

// Apply auth middleware to all chat routes
router.use(auth);

// Create a new conversation
router.post('/conversations', chatController.createConversation);

// Get all conversations for the logged-in user
router.get('/conversations', chatController.getConversations);

// Get a specific conversation with its messages
router.get('/conversations/:id', chatController.getConversation);

// Add a message to a conversation
router.post('/conversations/:id/messages', chatController.addMessage);

// Update conversation details (title, etc.)
router.put('/conversations/:id', chatController.updateConversation);

// Delete a conversation (soft delete)
//router.delete('/conversations/:id', chatController.deleteConversation);

// Original delete route (soft delete)
router.delete('/conversations/:id', auth, chatController.deleteConversation);

// Optional: Add a new route for permanent deletion
router.delete('/conversations/:id/permanent', auth, chatController.hardDeleteConversation);


module.exports = router;
