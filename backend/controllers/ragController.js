const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const Message = require('../models/message');
const Conversation = require('../models/conversation');
const modelServer = require('../config/modelServer');
const { HttpError } = require('../middleware/errors');

const QUERY_TIMEOUT_MS = 120000; // LLM calls can be slow — 2 min, never hang
// Indexing a large PDF can legitimately take a long time, but the request
// must still be finite — cap it at 30 minutes.
const INDEX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_QUERY_LENGTH = 2000;

// Indexing status is process-global on purpose: this deployment runs a single
// backend instance against a single model server, so one shared status object
// is correct (single-tenant assumption). If the backend ever scales to
// multiple replicas, this must move to a shared store (DB/Redis).
let indexingStatus = {
  isIndexing: false,
  progress: 0,
  error: null,
  message: null,
  lastIndexed: null,
  currentFile: null
};

const DATA_DIR = path.join(__dirname, '../../model-server/data');
const VECTOR_STORE_DIR = path.join(__dirname, '../../model-server/vector_store');

exports.uploadPdf = (req, res) => {
  if (!req.file) {
    throw new HttpError(400, 'No file uploaded');
  }

  // Log identifiers/sizes only — not the raw file object.
  console.log(`Upload saved: ${req.file.filename} (${req.file.size} bytes)`);

  // Check if there's existing metadata for this file and remove it
  // to ensure it shows up as unindexed
  const baseFileName = req.file.filename.replace('.pdf', '');
  const metadataPath = path.join(VECTOR_STORE_DIR, `${baseFileName}_metadata.json`);

  if (fs.existsSync(metadataPath)) {
    try {
      fs.unlinkSync(metadataPath);
      console.log(`Deleted existing metadata file for ${baseFileName} to mark as unindexed`);
    } catch (err) {
      console.warn(`Warning: Could not delete metadata file ${metadataPath}:`, err.message);
    }
  }

  res.status(200).json({
    success: true,
    message: 'File uploaded successfully and ready for indexing',
    filename: req.file.filename,
    requiresIndexing: true
  });
};

// Index the document
exports.indexDocument = (req, res) => {
  if (indexingStatus.isIndexing) {
    throw new HttpError(409, 'Indexing already in progress');
  }

  const { filename } = req.body || {};

  if (!filename || typeof filename !== 'string') {
    throw new HttpError(400, 'Filename is required');
  }

  // Sanitize filename to prevent path traversal and ensure it's a PDF
  const safeFilename = path.basename(filename);
  if (safeFilename !== filename || !safeFilename.toLowerCase().endsWith('.pdf')) {
    throw new HttpError(400, 'Invalid filename. Only PDF files in the data directory are allowed.');
  }

  const pdfPath = path.join(DATA_DIR, safeFilename);
  if (!fs.existsSync(pdfPath)) {
    throw new HttpError(404, `PDF file ${filename} not found. Please upload the file first.`);
  }

  indexingStatus = {
    isIndexing: true,
    progress: 0,
    error: null,
    message: null,
    lastIndexed: null,
    currentFile: filename
  };

  console.log(`Starting indexing for ${filename} via model server`);

  // Kick off indexing on the model server, which runs the indexer in-process
  // at POST /index. The request resolves only when indexing finishes (or
  // fails), so indexingStatus reflects the outcome — and isIndexing always
  // resets via .finally(), even on unexpected rejection shapes.
  modelServer
    .post('/index', { filename: safeFilename }, { timeout: INDEX_TIMEOUT_MS })
    .then((response) => {
      console.log(`Indexing of ${filename} completed on model server`);
      indexingStatus.progress = 100;
      indexingStatus.lastIndexed = new Date().toISOString();
      indexingStatus.message =
        (response.data && response.data.message) ||
        `Indexing of ${filename} completed successfully`;
      indexingStatus.error = null;
    })
    .catch((error) => {
      console.error(`Indexing of ${filename} failed:`, error.message);
      const detail =
        (error.response && error.response.data &&
          (error.response.data.message || error.response.data.error)) ||
        error.message;
      indexingStatus.error = `Indexing failed on model server: ${detail}`;
    })
    .finally(() => {
      indexingStatus.isIndexing = false;
    });

  res.status(202).json({
    success: true,
    message: `Indexing started for ${filename}`,
    status: indexingStatus
  });
};

// Check indexing status
exports.getIndexingStatus = (req, res) => {
  res.status(200).json({
    success: true,
    status: indexingStatus
  });
};

// Query the RAG system using the Flask model server
exports.queryRag = async (req, res) => {
  const body = req.body || {};
  const rawQuery = body.question || body.query;
  const conversationId = body.conversationId;

  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    throw new HttpError(400, 'Question is required');
  }
  const queryText = rawQuery.trim();
  if (queryText.length > MAX_QUERY_LENGTH) {
    throw new HttpError(400, `Question is too long (max ${MAX_QUERY_LENGTH} characters)`);
  }

  // Log the length, not the raw query text — questions may contain PII.
  console.log(`RAG query received (length=${queryText.length})`);

  // Verify the conversation exists and belongs to the authenticated user
  if (conversationId) {
    const conversation = mongoose.isValidObjectId(conversationId)
      ? await Conversation.findById(conversationId)
      : null;

    if (!conversation) {
      throw new HttpError(404, 'Conversation not found');
    }
    if (String(conversation.userId) !== String(req.userId)) {
      throw new HttpError(403, 'You do not have access to this conversation');
    }
  }

  let chatHistory = [];
  if (conversationId) {
    try {
      const messages = await Message.find({ conversationId })
        .sort({ timestamp: -1 })
        .limit(10);

      chatHistory = messages.reverse().map((msg) => ({
        role: msg.role,
        content: msg.content
      }));
    } catch (error) {
      console.error('Error fetching chat history:', error.message);
    }
  }

  let rawData;
  try {
    const modelResponse = await modelServer.post(
      '/query',
      { query: queryText, top_k: 5, chat_history: chatHistory },
      { timeout: QUERY_TIMEOUT_MS }
    );
    rawData = modelResponse.data;
  } catch (error) {
    console.error('Model server /query failed:', error.message);

    // Request timed out waiting for the model server
    if (error.code === 'ECONNABORTED' ||
        (error.message && error.message.toLowerCase().includes('timeout'))) {
      throw new HttpError(504, 'Model server timed out while generating a response');
    }
    // Model server unreachable (connection refused, DNS failure, etc.)
    if (!error.response) {
      throw new HttpError(502, 'Model server is unreachable');
    }
    // Model server responded with an error status — don't leak its body
    throw new HttpError(502, 'Error generating response from model server');
  }

  let plainTextAnswer = '';
  let sources = [];
  let enhancedQuery = null;
  let originalQuery = null;

  if (rawData && rawData.response && typeof rawData.response === 'object') {
    const response = rawData.response;
    plainTextAnswer = typeof response.answer === 'string'
      ? response.answer
      : JSON.stringify(response.answer, null, 2);
    sources = response.sources || [];
    enhancedQuery = response.enhanced_query || null;
    originalQuery = response.original_query || null;
  } else {
    plainTextAnswer = "I'm sorry, I couldn't generate a proper response. Please try again.";
    console.warn('Unexpected model server response structure');
  }

  console.log(
    `Model server answered (answer length=${plainTextAnswer.length}, sources=${sources.length})`
  );

  if (conversationId) {
    try {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        console.warn(`Conversation ${conversationId} not found, cannot save messages`);
      } else {
        // Only suppress a duplicate when the LATEST message matches — an
        // identical message from earlier in the conversation must not block
        // saving a new one.
        const lastUserMessage = await Message.findOne({
          conversationId,
          role: 'user'
        }).sort({ timestamp: -1 });

        if (!lastUserMessage || lastUserMessage.content !== queryText) {
          await Message.create({
            conversationId,
            role: 'user',
            content: queryText
          });
        } else {
          console.log('Skipping duplicate user message (matches latest)');
        }

        const lastAssistantMessage = await Message.findOne({
          conversationId,
          role: 'assistant'
        }).sort({ timestamp: -1 });

        if (!lastAssistantMessage || lastAssistantMessage.content !== plainTextAnswer) {
          await Message.create({
            conversationId,
            role: 'assistant',
            content: plainTextAnswer,
            metadata: {
              sources: sources,
              enhanced_query: enhancedQuery,
              original_query: originalQuery
            }
          });
        } else {
          console.log('Skipping duplicate assistant message (matches latest)');
        }

        conversation.updatedAt = Date.now();
        await conversation.save();
      }
    } catch (error) {
      console.error('Error saving to conversation history:', error.message);
    }
  }

  const isJsonFormat = req.query.format === 'json' || body.format === 'json';
  if (isJsonFormat || !req.query.format) {
    return res.status(200).json({
      answer: plainTextAnswer,
      sources: sources,
      enhanced_query: enhancedQuery,
      original_query: originalQuery
    });
  }
  res.setHeader('Content-Type', 'text/plain');
  return res.status(200).send(String(plainTextAnswer));
};

exports.getDocuments = (req, res) => {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    return res.status(200).json({ documents: [] });
  }

  // Get all PDF files from data directory
  const pdfFiles = fs.readdirSync(DATA_DIR)
    .filter((file) => file.toLowerCase().endsWith('.pdf'));

  // Create a set of indexed document names (without extension)
  const indexedDocsSet = new Set();

  if (fs.existsSync(VECTOR_STORE_DIR)) {
    const metadataFiles = fs.readdirSync(VECTOR_STORE_DIR)
      .filter((file) => file.endsWith('_metadata.json'));
    metadataFiles.forEach((file) => {
      indexedDocsSet.add(file.replace('_metadata.json', '').toLowerCase());
    });
  }

  // Map PDF files to document objects — filename/size only, never the
  // absolute server-side path.
  const documents = pdfFiles.map((file) => {
    const fileName = file.replace('.pdf', '');
    const stats = fs.statSync(path.join(DATA_DIR, file));

    return {
      id: fileName,
      filename: file,
      originalName: file,
      uploadDate: stats.mtime,
      indexed: indexedDocsSet.has(fileName.toLowerCase()),
      size: stats.size
    };
  });

  console.log(`Listed ${documents.length} documents (${indexedDocsSet.size} indexed)`);

  res.status(200).json({ documents });
};
