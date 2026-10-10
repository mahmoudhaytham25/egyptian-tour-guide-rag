const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const ragController = require('../controllers/ragController');
const auth = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { HttpError } = require('../middleware/errors');
const { DATA_DIR } = require('../config/paths');

// Store uploads under a sanitized version of the client's filename: a safe
// basename ending in .pdf, matching the model server's filename validation.
function safePdfFilename(originalname) {
  const base = path.basename(String(originalname || ''));
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return safe.toLowerCase().endsWith('.pdf') && safe.length > 4 ? safe : null;
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, DATA_DIR);
  },
  filename: function(req, file, cb) {
    const safe = safePdfFilename(file.originalname);
    if (!safe) {
      return cb(new Error('Invalid filename. PDF files must end in .pdf'));
    }
    cb(null, safe);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max upload size
  fileFilter: function(req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed!'), false);
    }
    cb(null, true);
  }
});

// Wrap upload.single so multer failures map to proper client-error statuses
// instead of falling through to a generic 500.
const uploadSingle = (req, res, next) => {
  upload.single('pdf')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new HttpError(413, 'File too large (max 50 MB)'));
      }
      return next(new HttpError(400, err.message));
    }
    // fileFilter rejection and other non-multer errors → 400
    return next(new HttpError(400, err.message));
  });
};

// Looser limiter for the expensive endpoints — bounded, but a real session
// can legitimately issue many queries/uploads in a short window.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX) || 60
});

// Health check endpoint (public)
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'RAG API is healthy' });
});

// Apply auth middleware to all routes below
router.use(auth);

router.post('/upload', apiLimiter, uploadSingle, ragController.uploadPdf);

// Index the uploaded PDF
router.post('/index', apiLimiter, ragController.indexDocument);

router.get('/indexing-status', ragController.getIndexingStatus);

// Query the RAG system
router.post('/query', apiLimiter, ragController.queryRag);

router.get('/documents', ragController.getDocuments);

module.exports = router;
