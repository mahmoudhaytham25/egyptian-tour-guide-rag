const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const Message = require('../models/message');
const Conversation = require('../models/conversation');
const modelServer = require('../config/modelServer');
const { HttpError } = require('../middleware/errors');
const { DATA_DIR, VECTOR_STORE_DIR } = require('../config/paths');

const QUERY_TIMEOUT_MS = 120000; // LLM calls can be slow — 2 min, never hang
// POST /index on the model server returns 202 immediately (indexing runs
// async there), so a short timeout is enough — it only bounds the handshake.
const INDEX_TIMEOUT_MS = 10000;
const INDEX_STATUS_TIMEOUT_MS = 5000;
const MAX_QUERY_LENGTH = 2000;
const DEFAULT_DOCUMENT = 'egyptian_history';
const SAFE_BASENAME_RE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]+$/;

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
  currentFile: null,
  jobId: null
};

function safePdfFilename(filename) {
  const base = path.basename(String(filename));
  if (base !== filename || !SAFE_BASENAME_RE.test(base) ||
      !base.toLowerCase().endsWith('.pdf')) {
    return null;
  }
  return base;
}

exports.uploadPdf = (req, res) => {
  if (!req.file) {
    throw new HttpError(400, 'No file uploaded');
  }

  // Log identifiers/sizes only — not the raw file object.
  console.log(`Upload saved: ${req.file.filename} (${req.file.size} bytes)`);

  // Remove any existing index artifacts for this file so a re-upload shows
  // up as unindexed and a stale index can't keep serving old answers.
  const baseFileName = path.basename(req.file.filename, path.extname(req.file.filename));
  const metadataPath = path.join(VECTOR_STORE_DIR, `${baseFileName}_metadata.json`);
  const vectorsPath = path.join(VECTOR_STORE_DIR, `${baseFileName}_vectors.npz`);

  for (const artifact of [metadataPath, vectorsPath]) {
    if (fs.existsSync(artifact)) {
      try {
        fs.unlinkSync(artifact);
        console.log(`Deleted existing index artifact ${path.basename(artifact)} for ${baseFileName}`);
      } catch (err) {
        console.warn(`Warning: Could not delete index artifact ${artifact}:`, err.message);
      }
    }
  }

  res.status(200).json({
    success: true,
    message: 'File uploaded successfully and ready for indexing',
    filename: req.file.filename,
    requiresIndexing: true
  });
};

// Index the document — the model server runs indexing asynchronously and
// answers 202 { job_id, filename, status: 'indexing' } immediately; the
// frontend tracks progress via GET /api/indexing-status.
exports.indexDocument = async (req, res) => {
  if (indexingStatus.isIndexing) {
    throw new HttpError(409, 'Indexing already in progress');
  }

  const { filename } = req.body || {};

  if (!filename || typeof filename !== 'string') {
    throw new HttpError(400, 'Filename is required');
  }

  // Sanitize filename to prevent path traversal and ensure it's a PDF
  const safeFilename = safePdfFilename(filename);
  if (!safeFilename) {
    throw new HttpError(400, 'Invalid filename. Only PDF files in the data directory are allowed.');
  }

  const pdfPath = path.join(DATA_DIR, safeFilename);
  if (!fs.existsSync(pdfPath)) {
    throw new HttpError(404, `PDF file ${filename} not found. Please upload the file first.`);
  }

  let response;
  try {
    response = await modelServer.post(
      '/index',
      { filename: safeFilename },
      { timeout: INDEX_TIMEOUT_MS }
    );
  } catch (error) {
    // Surface the model server's own client errors (400/404/409); anything
    // else is an upstream failure.
    const detail =
      (error.response && error.response.data &&
        (error.response.data.error || error.response.data.message)) ||
      error.message;
    const status = error.response && error.response.status;
    if (status === 409) {
      // A job is already running over there — reflect it locally.
      indexingStatus.isIndexing = true;
      throw new HttpError(409, String(detail));
    }
    if (status && status < 500) {
      throw new HttpError(status, String(detail));
    }
    if (!error.response) {
      throw new HttpError(502, 'Model server is unreachable');
    }
    throw new HttpError(502, `Indexing failed on model server: ${detail}`);
  }

  if (response.data && response.data.success === false) {
    throw new HttpError(502, String(response.data.error || 'Indexing failed on model server'));
  }

  console.log(`Indexing of ${safeFilename} started on model server`);

  indexingStatus = {
    isIndexing: true,
    progress: 0,
    error: null,
    message: null,
    lastIndexed: null,
    currentFile: safeFilename,
    jobId: (response.data && response.data.job_id) || null
  };

  res.status(202).json({
    success: true,
    ...(response.data || {}),
    status: indexingStatus
  });
};

// Merge the model server's single-job status into the shared indexingStatus.
async function pollModelServerIndexStatus() {
  try {
    const { data } = await modelServer.get('/index/status', {
      timeout: INDEX_STATUS_TIMEOUT_MS
    });
    if (!data || !data.status) {
      return;
    }
    switch (data.status) {
      case 'indexing':
        indexingStatus.isIndexing = true;
        indexingStatus.jobId = data.job_id || indexingStatus.jobId;
        indexingStatus.currentFile = data.filename || indexingStatus.currentFile;
        indexingStatus.error = null;
        break;
      case 'done': {
        const isNew = indexingStatus.isIndexing ||
          (data.job_id && indexingStatus.jobId !== data.job_id);
        indexingStatus.isIndexing = false;
        indexingStatus.jobId = data.job_id || indexingStatus.jobId;
        indexingStatus.currentFile = data.filename || indexingStatus.currentFile;
        indexingStatus.progress = 100;
        indexingStatus.error = null;
        indexingStatus.message = `Indexing of ${indexingStatus.currentFile} completed successfully`;
        if (isNew || !indexingStatus.lastIndexed) {
          indexingStatus.lastIndexed = new Date().toISOString();
        }
        break;
      }
      case 'error':
        indexingStatus.isIndexing = false;
        indexingStatus.jobId = data.job_id || indexingStatus.jobId;
        indexingStatus.currentFile = data.filename || indexingStatus.currentFile;
        indexingStatus.error =
          data.error || 'Indexing failed on model server';
        break;
      case 'idle':
        indexingStatus.isIndexing = false;
        break;
      default:
        break;
    }
  } catch (error) {
    // A failed poll must not break the status endpoint — report the last
    // known state instead.
    console.warn('Could not poll model-server indexing status:', error.message);
  }
}

// Check indexing status — lazily polls the model server on each request (no
// background loop; the frontend polls this endpoint while indexing).
exports.getIndexingStatus = async (req, res) => {
  await pollModelServerIndexStatus();
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

  // Optional target document — a safe PDF basename without the extension.
  let documentName = DEFAULT_DOCUMENT;
  if (body.document !== undefined && body.document !== null) {
    const doc = path.basename(String(body.document));
    if (doc !== String(body.document) || !SAFE_BASENAME_RE.test(doc)) {
      throw new HttpError(400, 'Invalid document name');
    }
    documentName = doc.replace(/\.pdf$/i, '');
  }

  // Log the length, not the raw query text — questions may contain PII.
  console.log(`RAG query received (length=${queryText.length})`);

  // Verify the conversation exists, is active, and belongs to the
  // authenticated user (the filter covers ownership — no separate check).
  let conversation = null;
  let chatHistory = [];
  if (conversationId) {
    if (!mongoose.isValidObjectId(conversationId)) {
      throw new HttpError(404, 'Conversation not found');
    }
    const historyPromise = Promise.resolve()
      .then(() => Message.find({ conversationId })
        .sort({ timestamp: -1 })
        .limit(10))
      .then((messages) =>
        messages.slice().reverse().map((msg) => ({
          role: msg.role,
          content: msg.content
        }))
      )
      .catch((error) => {
        console.error('Error fetching chat history:', error.message);
        return [];
      });
    [conversation, chatHistory] = await Promise.all([
      Conversation.findOne({ _id: conversationId, userId: req.userId, isActive: true }),
      historyPromise
    ]);
    if (!conversation) {
      throw new HttpError(404, 'Conversation not found');
    }
  }

  let rawData;
  try {
    const modelResponse = await modelServer.post(
      '/query',
      { query: queryText, top_k: 5, document: documentName, chat_history: chatHistory },
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
    // Model server responded with an error status — surface its error
    // message when it's a plain string field, never the raw body.
    const detail = error.response.data && error.response.data.error;
    throw new HttpError(502, detail || 'Error generating response from model server');
  }

  // Generation failed upstream — return the error without persisting an
  // assistant message (no poisoned conversation entries).
  if (rawData && rawData.success === false) {
    throw new HttpError(
      502,
      String(rawData.error || 'Error generating response from model server')
    );
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

  if (conversation) {
    try {
      // Only suppress a duplicate when the LATEST message matches — an
      // identical message from earlier in the conversation must not block
      // saving a new one.
      const [lastUserMessage, lastAssistantMessage] = await Promise.all([
        Message.findOne({ conversationId, role: 'user' }).sort({ timestamp: -1 }),
        Message.findOne({ conversationId, role: 'assistant' }).sort({ timestamp: -1 })
      ]);

      if (!lastUserMessage || lastUserMessage.content !== queryText) {
        await Message.create({
          conversationId,
          role: 'user',
          content: queryText
        });
      } else {
        console.log('Skipping duplicate user message (matches latest)');
      }

      if (!lastAssistantMessage || lastAssistantMessage.content !== plainTextAnswer) {
        await Message.create({
          conversationId,
          role: 'assistant',
          content: plainTextAnswer,
          metadata: {
            sources: sources,
            enhanced_query: enhancedQuery,
            original_query: originalQuery,
            document: documentName
          }
        });
      } else {
        console.log('Skipping duplicate assistant message (matches latest)');
      }

      // Only the timestamp changed — updateOne avoids hydrating/saving the
      // doc; the explicit $set is needed because updateOne skips pre-save hooks.
      await Conversation.updateOne(
        { _id: conversation._id },
        { $set: { updatedAt: new Date() } }
      );
    } catch (error) {
      console.error('Error saving to conversation history:', error.message);
    }
  }

  const format = req.query.format || body.format;
  if (format === 'text') {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(String(plainTextAnswer));
  }
  return res.status(200).json({
    answer: plainTextAnswer,
    sources: sources,
    enhanced_query: enhancedQuery,
    original_query: originalQuery
  });
};

exports.getDocuments = (req, res) => {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    return res.status(200).json({ documents: [] });
  }

  // Get all PDF files from data directory
  const pdfFiles = fs.readdirSync(DATA_DIR)
    .filter((file) => file.toLowerCase().endsWith('.pdf'));

  // A document counts as indexed only when BOTH index artifacts exist —
  // a metadata file without its vectors (or vice versa) is a broken index.
  const indexedDocsSet = new Set();

  if (fs.existsSync(VECTOR_STORE_DIR)) {
    const metadataBases = fs.readdirSync(VECTOR_STORE_DIR)
      .filter((file) => file.endsWith('_metadata.json'))
      .map((file) => file.replace('_metadata.json', ''));
    metadataBases.forEach((base) => {
      if (fs.existsSync(path.join(VECTOR_STORE_DIR, `${base}_vectors.npz`))) {
        indexedDocsSet.add(base.toLowerCase());
      }
    });
  }

  // Map PDF files to document objects — filename/size only, never the
  // absolute server-side path. A file that disappears between readdir and
  // stat is skipped rather than 500ing the listing.
  const documents = pdfFiles.map((file) => {
    const fileName = path.basename(file, path.extname(file));
    let stats;
    try {
      stats = fs.statSync(path.join(DATA_DIR, file));
    } catch (err) {
      return null;
    }

    return {
      id: fileName,
      filename: file,
      originalName: file,
      uploadDate: stats.mtime,
      indexed: indexedDocsSet.has(fileName.toLowerCase()),
      size: stats.size
    };
  }).filter(Boolean);

  console.log(`Listed ${documents.length} documents (${indexedDocsSet.size} indexed)`);

  res.status(200).json({ documents });
};
