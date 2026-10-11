const express = require('express');
const router = express.Router();
const multer = require('multer');

const ragController = require('../controllers/ragController');
const auth = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { HttpError } = require('../middleware/errors');
const { DATA_DIR } = require('../config/paths');
const { sanitizeUploadName } = require('../utils/pdfFilename');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, DATA_DIR);
  },
  filename: function(req, file, cb) {
    // Store uploads under a sanitized version of the client's filename: a
    // safe basename ending in .pdf, matching the model server's validation.
    const safe = sanitizeUploadName(file.originalname);
    if (!safe) {
      return cb(new HttpError(400, 'Invalid filename. PDF files must end in .pdf'));
    }
    cb(null, safe);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max upload size
  fileFilter: function(req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      return cb(new HttpError(400, 'Only PDF files are allowed!'), false);
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
    // Our own validation errors (fileFilter / filename callback above).
    if (err instanceof HttpError) {
      return next(err);
    }
    // Anything else is a storage/FS failure (missing dir, EACCES, ENOSPC) —
    // err.message embeds absolute server paths, so return a generic 500.
    return next(new HttpError(500, 'Upload failed'));
  });
};

// Looser limiter for the expensive endpoints — bounded, but a real session
// can legitimately issue many queries/uploads in a short window.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX) || 60
});

// Permissive limiter for the status/list GETs — each /indexing-status call
// is proxied to the model server, so an unlimited endpoint would be a cheap
// amplification path. The frontend's 2s poll uses 30/min — 120/min is slack.
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.STATUS_RATE_LIMIT_MAX) || 120
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

router.get('/indexing-status', statusLimiter, ragController.getIndexingStatus);

// Query the RAG system
router.post('/query', apiLimiter, ragController.queryRag);

router.get('/documents', statusLimiter, ragController.getDocuments);

module.exports = router;
