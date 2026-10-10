/**
 * Tests for routes/api.js + controllers/ragController.js.
 *
 * Mocked: mongoose models (User/Conversation/Message) and the model-server
 * axios instance (config/modelServer — all calls to the Flask model server).
 * fs.existsSync is spied on per-test to simulate uploaded PDFs in the shared
 * data directory.
 */
process.env.JWT_SECRET = 'test-jwt-secret';

const fs = require('fs');
const path = require('path');
const request = require('supertest');

jest.mock('../models/user', () => require('./mockFactories').makeUserModel());
jest.mock('../models/conversation', () => require('./mockFactories').makeConversationModel());
jest.mock('../models/message', () => require('./mockFactories').makeMessageModel());
jest.mock('../config/modelServer', () => ({ post: jest.fn() }));

const modelServer = require('../config/modelServer');
const User = require('../models/user');
const Conversation = require('../models/conversation');
const { buildApp, authHeader } = require('./helpers');

const app = buildApp();
const AUTH = authHeader();

/** Let queued promise callbacks (indexing status updates) run. */
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks does not remove mock implementations — reset them so a
  // configured modelServer.post from one test can't leak into the next.
  modelServer.post.mockReset();
  User.findById.mockResolvedValue({ _id: 'user-1', email: 'a@b.com' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * Make fs.existsSync answer `true` only for the given filenames inside the
 * model-server data dir (simulating uploaded PDFs).
 */
function mockDataFiles(...names) {
  jest.spyOn(fs, 'existsSync').mockImplementation((p) =>
    names.some((n) => String(p).endsWith(n))
  );
}

describe('model-server client config', () => {
  test('sends the internal shared-secret header', () => {
    // The axios instance is mocked above; assert the wiring in source.
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'config', 'modelServer.js'),
      'utf8'
    );
    expect(src).toMatch(/X-Internal-Token/);
    expect(src).toMatch(/INTERNAL_API_TOKEN/);
  });
});

describe('POST /api/index — filename validation', () => {
  test("filename 'test.pdf' is accepted → 202 and model server /index called", async () => {
    mockDataFiles('test.pdf');
    modelServer.post.mockResolvedValue({ data: { success: true, message: 'done' } });

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(202);
    expect(modelServer.post).toHaveBeenCalledTimes(1);
    expect(modelServer.post).toHaveBeenCalledWith(
      '/index',
      { filename: 'test.pdf' },
      // Finite, generous cap (30 min) — the old code used timeout: 0.
      expect.objectContaining({ timeout: 30 * 60 * 1000 })
    );

    await flushPromises(); // let the status update settle
  });

  test("path traversal '../etc/passwd' → 400, model server not called", async () => {
    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: '../etc/passwd' });

    expect(res.status).toBe(400);
    expect(modelServer.post).not.toHaveBeenCalled();
  });

  test("nested path 'a/b.pdf' → 400 (path.basename sanitization)", async () => {
    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'a/b.pdf' });

    expect(res.status).toBe(400);
    expect(modelServer.post).not.toHaveBeenCalled();
  });

  test("non-PDF filename 'notes.txt' → 400", async () => {
    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'notes.txt' });

    expect(res.status).toBe(400);
    expect(modelServer.post).not.toHaveBeenCalled();
  });

  test('missing filename → 400', async () => {
    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({});

    expect(res.status).toBe(400);
    expect(modelServer.post).not.toHaveBeenCalled();
  });

  test('PDF not in data dir → 404', async () => {
    mockDataFiles('other.pdf'); // 'ghost.pdf' does not "exist"

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'ghost.pdf' });

    expect(res.status).toBe(404);
    expect(modelServer.post).not.toHaveBeenCalled();
  });
});

describe('POST /api/index — model server handling', () => {
  test('409 while indexing is already in progress', async () => {
    mockDataFiles('test.pdf');

    // Model server /index that never resolves → isIndexing stays true
    let resolveIndex;
    modelServer.post.mockImplementation(() => new Promise((r) => { resolveIndex = r; }));

    await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' }); // leaves isIndexing = true

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already in progress/i);

    // Finish indexing so module-level status resets for later tests
    resolveIndex({ data: { success: true } });
    await flushPromises();
  });

  test('successful indexing resets status (progress 100, isIndexing false)', async () => {
    mockDataFiles('test.pdf');
    modelServer.post.mockResolvedValue({ data: { success: true, message: 'Indexing done' } });

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(202);

    await flushPromises();

    const status = await request(app)
      .get('/api/indexing-status')
      .set('Authorization', AUTH);

    expect(status.status).toBe(200);
    expect(status.body.status.isIndexing).toBe(false);
    expect(status.body.status.progress).toBe(100);
    expect(status.body.status.error).toBeNull();
  });

  test('model server failure resets indexing status with an error', async () => {
    mockDataFiles('test.pdf');
    modelServer.post.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    await flushPromises();

    const status = await request(app)
      .get('/api/indexing-status')
      .set('Authorization', AUTH);

    expect(status.status).toBe(200);
    expect(status.body.status.isIndexing).toBe(false);
    expect(status.body.status.error).toMatch(/model server/i);
  });

  test('model server error response surfaces its message in status', async () => {
    mockDataFiles('test.pdf');
    modelServer.post.mockRejectedValue({
      message: 'Request failed with status code 500',
      response: { status: 500, data: { success: false, message: 'Indexing failed for test.pdf' } }
    });

    await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    await flushPromises();

    const status = await request(app)
      .get('/api/indexing-status')
      .set('Authorization', AUTH);

    expect(status.status).toBe(200);
    expect(status.body.status.isIndexing).toBe(false);
    expect(status.body.status.error).toMatch(/Indexing failed for test\.pdf/);
  });
});

describe('multer upload config', () => {
  test('50MB fileSize limit is configured', () => {
    // The multer instance is not exported; assert the config in source.
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'api.js'), 'utf8');
    expect(src).toMatch(/fileSize:\s*50\s*\*\s*1024\s*\*\s*1024/);
  });

  test('non-PDF upload is rejected by fileFilter → 400', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', AUTH)
      .attach('pdf', Buffer.from('not a pdf'), {
        filename: 'evil.txt',
        contentType: 'text/plain'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Only PDF files are allowed/);
  });

  test('missing file → 400', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', AUTH)
      .field('anything', 'value');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/No file uploaded/);
  });
});

describe('POST /api/query', () => {
  test('non-string question → 400', async () => {
    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 42 });

    expect(res.status).toBe(400);
  });

  test('question over the length cap → 400', async () => {
    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'x'.repeat(2001) });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too long/i);
  });

  test('conversationId that does not exist → 404', async () => {
    Conversation.findById.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi', conversationId: '64b7f0f4c2a1d3e5f6071829' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Conversation not found');
  });

  test('malformed conversationId → 404 (not a CastError 500)', async () => {
    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi', conversationId: 'conv-x' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Conversation not found');
    expect(Conversation.findById).not.toHaveBeenCalled();
  });

  test('conversationId owned by another user → 403', async () => {
    Conversation.findById.mockResolvedValue({
      _id: '64b7f0f4c2a1d3e5f6071829',
      userId: 'someone-else', // ≠ req.userId ('user-1')
      save: jest.fn()
    });

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi', conversationId: '64b7f0f4c2a1d3e5f6071829' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/do not have access/);
    expect(modelServer.post).not.toHaveBeenCalled(); // never reaches model server
  });

  test('successful query → 200 with answer, model server called with 120s timeout', async () => {
    modelServer.post.mockResolvedValue({
      data: {
        response: {
          answer: 'The pyramids are in Giza.',
          sources: ['doc1'],
          enhanced_query: 'eq',
          original_query: 'oq'
        }
      }
    });

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'Where are the pyramids?' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('The pyramids are in Giza.');
    expect(res.body.sources).toEqual(['doc1']);

    expect(modelServer.post).toHaveBeenCalledWith(
      '/query',
      expect.objectContaining({ query: 'Where are the pyramids?', top_k: 5 }),
      expect.objectContaining({ timeout: 120000 })
    );
  });

  test('model server timeout → 504', async () => {
    modelServer.post.mockRejectedValue(
      Object.assign(new Error('timeout of 120000ms exceeded'), { code: 'ECONNABORTED' })
    );

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi' });

    expect(res.status).toBe(504);
    expect(res.body.message).toMatch(/timed out/i);
  });

  test('model server unreachable (no response) → 502', async () => {
    modelServer.post.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi' });

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/unreachable/i);
  });

  test('model server error response → 502 without leaking the upstream body', async () => {
    modelServer.post.mockRejectedValue({
      message: 'Request failed with status code 500',
      response: { status: 500, data: 'internal error' }
    });

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi' });

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/Error generating response/);
    expect(res.body.error).toBeUndefined();
  });
});

describe('GET /api/documents', () => {
  test('response includes filenames/sizes but never absolute paths', async () => {
    mockDataFiles('data', 'vector_store'); // both directories "exist"
    jest.spyOn(fs, 'readdirSync').mockImplementation((dir) =>
      String(dir).includes('vector_store') ? ['doc_metadata.json'] : ['doc.pdf']
    );
    jest.spyOn(fs, 'statSync').mockReturnValue({
      mtime: new Date('2025-01-01T00:00:00Z'),
      size: 1234
    });

    const res = await request(app)
      .get('/api/documents')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].filename).toBe('doc.pdf');
    expect(res.body.documents[0].indexed).toBe(true);
    expect(res.body.documents[0].size).toBe(1234);
    expect(res.body.documents[0].path).toBeUndefined();
  });
});
