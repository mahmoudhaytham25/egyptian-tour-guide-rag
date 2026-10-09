const Conversation = require('../models/conversation');
const Message = require('../models/message');

// Create a new conversation
exports.createConversation = async (req, res) => {
  try {
    let title = req.body.title || 'New Conversation';
    
    const conversation = new Conversation({
      userId: req.userId,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    await conversation.save();

    // If initial message is provided, save it
    if (req.body.message) {
      const message = new Message({
        conversationId: conversation._id,
        role: 'user',
        content: req.body.message
      });
      
      await message.save();
      
      // Update title with first few words of the message if no title provided
      if (!req.body.title) {
        const shortTitle = req.body.message.substring(0, 30) + (req.body.message.length > 30 ? '...' : '');
        conversation.title = shortTitle;
        await conversation.save();
      }
    }

    res.status(201).json(conversation);
  } catch (err) {
    console.error('Error creating conversation:', err);
    res.status(500).json({ message: 'Error creating conversation', error: err.message });
  }
};

// Get all conversations for a user
exports.getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({ 
      userId: req.userId,
      isActive: true
    })
    .sort({ updatedAt: -1 }); // Most recent first
    
    res.status(200).json(conversations);
  } catch (err) {
    console.error('Error retrieving conversations:', err);
    res.status(500).json({ message: 'Error retrieving conversations', error: err.message });
  }
};

// Get a specific conversation with its messages
exports.getConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.userId
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    const messages = await Message.find({
      conversationId: conversation._id
    }).sort({ timestamp: 1 }); // Oldest first for chat display
    
    res.status(200).json({
      conversation,
      messages
    });
  } catch (err) {
    console.error('Error retrieving conversation:', err);
    res.status(500).json({ message: 'Error retrieving conversation', error: err.message });
  }
};

// Add a message to a conversation
exports.addMessage = async (req, res) => {
  try {
    const { role, content } = req.body;
    
    if (!role || !content) {
      return res.status(400).json({ message: 'Role and content are required' });
    }
    
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.userId
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    // Create the message
    const message = new Message({
      conversationId: conversation._id,
      role,
      content,
      metadata: req.body.metadata || {}
    });
    
    await message.save();
    
    // Update conversation timestamp
    conversation.updatedAt = Date.now();
    await conversation.save();
    
    res.status(201).json(message);
  } catch (err) {
    console.error('Error adding message:', err);
    res.status(500).json({ message: 'Error adding message', error: err.message });
  }
};

// Update conversation details (title, etc.)
exports.updateConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.userId
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    // Update fields
    if (req.body.title) conversation.title = req.body.title;
    conversation.updatedAt = Date.now();
    
    await conversation.save();
    
    res.status(200).json(conversation);
  } catch (err) {
    console.error('Error updating conversation:', err);
    res.status(500).json({ message: 'Error updating conversation', error: err.message });
  }
};

// Delete a conversation (soft delete)
exports.deleteConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.userId
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    // Soft delete
    conversation.isActive = false;
    await conversation.save();
    
    res.status(200).json({ message: 'Conversation deleted successfully' });
  } catch (err) {
    console.error('Error deleting conversation:', err);
    res.status(500).json({ message: 'Error deleting conversation', error: err.message });
  }
};

exports.hardDeleteConversation = async (req, res) => {
  try {
    // First check if conversation exists and belongs to user
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.userId
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    // Delete all associated messages
    await Message.deleteMany({ conversationId: req.params.id });
    
    // Delete the conversation itself
    await Conversation.deleteOne({ _id: req.params.id });
    
    res.status(200).json({ message: 'Conversation permanently deleted' });
  } catch (err) {
    console.error('Error deleting conversation:', err);
    res.status(500).json({ message: 'Error deleting conversation' });
  }
};
