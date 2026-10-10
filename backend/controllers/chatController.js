const mongoose = require('mongoose');
const Conversation = require('../models/conversation');
const Message = require('../models/message');
const { HttpError } = require('../middleware/errors');

const VALID_ROLES = ['user', 'assistant'];
const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 4000;
const CONVERSATIONS_LIMIT = 50;
const MESSAGES_LIMIT = 200;

function assertValidConversationId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'Invalid conversation id');
  }
}

function validateTitle(title) {
  if (title !== undefined &&
      (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE_LENGTH)) {
    throw new HttpError(400, `Title must be a non-empty string of at most ${MAX_TITLE_LENGTH} characters`);
  }
}

function validateContent(content) {
  if (typeof content !== 'string' || !content.trim() || content.length > MAX_MESSAGE_LENGTH) {
    throw new HttpError(400, `Content must be a non-empty string of at most ${MAX_MESSAGE_LENGTH} characters`);
  }
}

// Whitelist the metadata field: only a plain object is stored, nothing else
// from the request body reaches the model (no mass-assignment).
function sanitizeMetadata(metadata) {
  if (metadata !== undefined &&
      (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
    throw new HttpError(400, 'Metadata must be an object');
  }
  return metadata || {};
}

async function findOwnedConversation(id, userId) {
  const conversation = await Conversation.findOne({ _id: id, userId });
  if (!conversation) {
    throw new HttpError(404, 'Conversation not found');
  }
  return conversation;
}

// Create a new conversation
exports.createConversation = async (req, res) => {
  const { title, message } = req.body || {};
  validateTitle(title);
  if (message !== undefined) {
    validateContent(message);
  }

  const conversation = new Conversation({
    userId: req.userId,
    title: (title && title.trim()) || 'New Conversation'
  });
  await conversation.save();

  // If initial message is provided, save it
  if (message) {
    const initialMessage = new Message({
      conversationId: conversation._id,
      role: 'user',
      content: message
    });
    await initialMessage.save();

    // Update title with first few words of the message if no title provided
    if (!title) {
      conversation.title = message.substring(0, 30) + (message.length > 30 ? '...' : '');
      await conversation.save();
    }
  }

  res.status(201).json(conversation);
};

// Get all conversations for a user (most recent first, bounded)
exports.getConversations = async (req, res) => {
  const conversations = await Conversation.find({
    userId: req.userId,
    isActive: true
  })
    .sort({ updatedAt: -1 })
    .limit(CONVERSATIONS_LIMIT);

  res.status(200).json(conversations);
};

// Get a specific conversation with its messages
exports.getConversation = async (req, res) => {
  assertValidConversationId(req.params.id);
  const conversation = await findOwnedConversation(req.params.id, req.userId);

  // Fetch the most recent messages, then present oldest-first for display.
  const messages = await Message.find({ conversationId: conversation._id })
    .sort({ timestamp: -1 })
    .limit(MESSAGES_LIMIT);
  messages.reverse();

  res.status(200).json({
    conversation,
    messages
  });
};

// Add a message to a conversation
exports.addMessage = async (req, res) => {
  assertValidConversationId(req.params.id);

  const { role, content } = req.body || {};
  if (!VALID_ROLES.includes(role)) {
    throw new HttpError(400, `Role must be one of: ${VALID_ROLES.join(', ')}`);
  }
  validateContent(content);
  const metadata = sanitizeMetadata((req.body || {}).metadata);

  const conversation = await findOwnedConversation(req.params.id, req.userId);

  // Create the message
  const message = new Message({
    conversationId: conversation._id,
    role,
    content,
    metadata
  });
  await message.save();

  // Update conversation timestamp
  conversation.updatedAt = Date.now();
  await conversation.save();

  res.status(201).json(message);
};

// Update conversation details (title only — no mass-assignment of other fields)
exports.updateConversation = async (req, res) => {
  assertValidConversationId(req.params.id);
  const title = (req.body || {}).title;
  validateTitle(title);

  const conversation = await findOwnedConversation(req.params.id, req.userId);

  if (title) {
    conversation.title = title.trim();
  }
  conversation.updatedAt = Date.now();
  await conversation.save();

  res.status(200).json(conversation);
};

// Delete a conversation (soft delete)
exports.deleteConversation = async (req, res) => {
  assertValidConversationId(req.params.id);
  const conversation = await findOwnedConversation(req.params.id, req.userId);

  conversation.isActive = false;
  await conversation.save();

  res.status(200).json({ message: 'Conversation deleted successfully' });
};

// Permanently delete a conversation and its messages
exports.hardDeleteConversation = async (req, res) => {
  assertValidConversationId(req.params.id);
  const conversation = await findOwnedConversation(req.params.id, req.userId);

  // Delete all associated messages, then the conversation itself
  await Message.deleteMany({ conversationId: conversation._id });
  await Conversation.deleteOne({ _id: conversation._id });

  res.status(200).json({ message: 'Conversation permanently deleted' });
};
