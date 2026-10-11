const mongoose = require('mongoose');
const Conversation = require('../models/conversation');
const Message = require('../models/message');
const { VALID_ROLES } = Message;
const { HttpError } = require('../middleware/errors');

const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_METADATA_BYTES = 8 * 1024;
const CONVERSATIONS_LIMIT = 50;
const MESSAGES_LIMIT = 200;
const FORBIDDEN_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

// Whitelist the metadata field: only a plain, bounded object with safe keys
// is stored — dotted/$-prefixed/prototype-polluting keys and oversized blobs
// are rejected here instead of blowing up at insert time.
function sanitizeMetadata(metadata) {
  if (metadata === undefined) {
    return {};
  }
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new HttpError(400, 'Metadata must be an object');
  }
  for (const key of Object.keys(metadata)) {
    if (key.includes('.') || key.startsWith('$') || FORBIDDEN_METADATA_KEYS.has(key)) {
      throw new HttpError(400, `Metadata key "${key}" is not allowed`);
    }
  }
  if (JSON.stringify(metadata).length > MAX_METADATA_BYTES) {
    throw new HttpError(400, `Metadata is too large (max ${MAX_METADATA_BYTES} bytes)`);
  }
  return metadata;
}

async function findOwnedConversation(id, userId) {
  const conversation = await Conversation.findOne({ _id: id, userId, isActive: true });
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

  // Derive the title up front — one conversation save, one message save.
  const derivedTitle = (title && title.trim()) ||
    (message
      ? message.substring(0, 30) + (message.length > 30 ? '...' : '')
      : 'New Conversation');

  const conversation = new Conversation({
    userId: req.userId,
    title: derivedTitle
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

  // Fetch conversation and messages in parallel — the message query is
  // scoped by the same id; a foreign/missing conversation still 404s below.
  const [conversation, messages] = await Promise.all([
    findOwnedConversation(req.params.id, req.userId),
    // Fetch the most recent messages, then present oldest-first for display.
    Message.find({ conversationId: req.params.id })
      .sort({ timestamp: -1 })
      .limit(MESSAGES_LIMIT)
  ]);
  messages.reverse();

  res.status(200).json({
    conversation,
    messages
  });
};

// Add a message to a conversation
exports.addMessage = async (req, res) => {
  assertValidConversationId(req.params.id);

  const { role, content, metadata } = req.body || {};
  if (!VALID_ROLES.includes(role)) {
    throw new HttpError(400, `Role must be one of: ${VALID_ROLES.join(', ')}`);
  }
  validateContent(content);
  const sanitizedMetadata = sanitizeMetadata(metadata);

  const conversation = await findOwnedConversation(req.params.id, req.userId);

  // Create the message
  const message = new Message({
    conversationId: conversation._id,
    role,
    content,
    metadata: sanitizedMetadata
  });

  // The message save and the conversation timestamp bump are independent —
  // updateOne skips the pre-save hook, so the $set is explicit.
  await Promise.all([
    message.save(),
    Conversation.updateOne(
      { _id: conversation._id },
      { $set: { updatedAt: new Date() } }
    )
  ]);

  res.status(201).json(message);
};

// Update conversation details (title only — no mass-assignment of other fields)
exports.updateConversation = async (req, res) => {
  assertValidConversationId(req.params.id);
  const title = (req.body || {}).title;
  // Unlike create, a title is required on update — but validateTitle already
  // covers empty/blank/over-long values, so only the missing case is extra.
  if (title === undefined) {
    throw new HttpError(400, 'A non-empty title is required');
  }
  validateTitle(title);

  const conversation = await findOwnedConversation(req.params.id, req.userId);

  conversation.title = title.trim();
  await conversation.save(); // pre-save hook bumps updatedAt

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

  // Delete all associated messages and the conversation itself — the two
  // deletes are independent and can run together.
  await Promise.all([
    Message.deleteMany({ conversationId: conversation._id }),
    Conversation.deleteOne({ _id: conversation._id })
  ]);

  res.status(200).json({ message: 'Conversation permanently deleted' });
};
