/**
 * Tests for routes/api.js + controllers/ragController.js.
 *
 * Mocked: mongoose models (User/Conversation/Message) and the model-server
 * axios instance (config/modelServer — all calls to the Flask model server).
 * fs.existsSync is spied on per-test to simulate uploaded PDFs in the shared
 * data directory.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');

jest.mock('../models/user', () => require('./mockFactories').makeUserModel());
jest.mock('../models/conversation', () => require('./mockFactories').makeConversationModel());
jest.mock('../models/message', () => require('./mockFactories').makeMessageModel());
jest.mock('../config/modelServer', () => ({ post: jest.fn(), get: jest.fn() }));

const modelServer = require('../config/modelServer');
const Conversation = require('../models/conversation');
const Message = require('../models/message');
const { buildApp, authHeader, mockAuthUser } = require('./helpers');

const app = buildApp();
const AUTH = authHeader();

/** Drive the module-level indexingStatus back to a non-indexing state. */
async function resetIndexing(status = 'idle') {
  modelServer.get.mockResolvedValueOnce({ data: { status } });
  await request(app)
    .get('/api/indexing-status')
    .set('Authorization', AUTH);
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks does not remove mock implementations — reset them so a
  // configured modelServer.post from one test can't leak into the next.
  modelServer.post.mockReset();
  modelServer.get.mockReset();
  // Default: the model server reports no indexing job running.
  modelServer.get.mockResolvedValue({ data: { status: 'idle' } });
  mockAuthUser({ _id: 'user-1', email: 'a@b.com' });
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
    modelServer.post.mockResolvedValue({
      data: { job_id: 'job-1', filename: 'test.pdf', status: 'indexing' }
    });

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(202);
    expect(res.body.job_id).toBe('job-1');
    expect(res.body.status.isIndexing).toBe(true);
    expect(modelServer.post).toHaveBeenCalledTimes(1);
    expect(modelServer.post).toHaveBeenCalledWith(
      '/index',
      { filename: 'test.pdf' },
      // /index is async on the model server now — a short timeout suffices.
      expect.objectContaining({ timeout: 10000 })
    );

    await resetIndexing();
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
    modelServer.post.mockResolvedValue({
      data: { job_id: 'job-1', filename: 'test.pdf', status: 'indexing' }
    });

    const first = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' }); // leaves isIndexing = true
    expect(first.status).toBe(202);

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already in progress/i);

    await resetIndexing();
  });

  test('upstream 409 from model server is surfaced', async () => {
    mockDataFiles('test.pdf');
    modelServer.post.mockRejectedValue({
      message: 'Request failed with status code 409',
      response: { status: 409, data: { error: 'indexing job already running' } }
    });

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already running/i);

    await resetIndexing();
  });

  test('indexing-status merges model server "done" (isIndexing false, progress 100)', async () => {
    mockDataFiles('test.pdf');
    modelServer.post.mockResolvedValue({
      data: { job_id: 'job-1', filename: 'test.pdf', status: 'indexing' }
    });

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(202);

    modelServer.get.mockResolvedValueOnce({
      data: { status: 'done', job_id: 'job-1', filename: 'test.pdf' }
    });
    const status = await request(app)
      .get('/api/indexing-status')
      .set('Authorization', AUTH);

    expect(status.status).toBe(200);
    expect(status.body.status.isIndexing).toBe(false);
    expect(status.body.status.progress).toBe(100);
    expect(status.body.status.lastIndexed).toBeTruthy();
    expect(status.body.status.error).toBeNull();
  });

  test('indexing-status merges model server "error" into status.error', async () => {
    mockDataFiles('test.pdf');
    modelServer.post.mockResolvedValue({
      data: { job_id: 'job-1', filename: 'test.pdf', status: 'indexing' }
    });

    await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    modelServer.get.mockResolvedValueOnce({
      data: { status: 'error', job_id: 'job-1', error: 'Indexing failed for test.pdf' }
    });
    const status = await request(app)
      .get('/api/indexing-status')
      .set('Authorization', AUTH);

    expect(status.status).toBe(200);
    expect(status.body.status.isIndexing).toBe(false);
    expect(status.body.status.error).toMatch(/Indexing failed for test\.pdf/);
  });

  test('model server unreachable at /index → 502', async () => {
    mockDataFiles('test.pdf');
    modelServer.post.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/unreachable/i);
  });

  test('model server error response surfaces its message', async () => {
    mockDataFiles('test.pdf');
    modelServer.post.mockRejectedValue({
      message: 'Request failed with status code 500',
      response: { status: 500, data: { success: false, error: 'Indexing failed for test.pdf' } }
    });

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/Indexing failed for test\.pdf/);
  });
});

describe('multer upload config', () => {
  test('50MB fileSize limit is configured', () => {
    // The multer instance is not exported; assert the config in source.
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'api.js'), 'utf8');
    expect(src).toMatch(/fileSize:\s*50\s*\*\s*1024\s*\*\s*1024/);
  });

  test('uploaded filename is sanitized, not hardcoded', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'api.js'), 'utf8');
    expect(src).not.toMatch(/egyptian_history\.pdf/);
    expect(src).toMatch(/file\.originalname/);
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

  test('PDF mimetype but non-.pdf filename → 400', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', AUTH)
      .attach('pdf', Buffer.from('%PDF-1.4 fake'), {
        filename: 'evil.txt',
        contentType: 'application/pdf'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid filename/);
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
    Conversation.findOne.mockResolvedValue(null);

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
    expect(Conversation.findOne).not.toHaveBeenCalled();
  });

  test('conversation lookup filters owner + isActive → 404 when no match', async () => {
    // Soft-deleted or foreign conversations are invisible to the query.
    Conversation.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi', conversationId: '64b7f0f4c2a1d3e5f6071829' });

    expect(res.status).toBe(404);
    expect(Conversation.findOne).toHaveBeenCalledWith({
      _id: '64b7f0f4c2a1d3e5f6071829',
      userId: 'user-1',
      isActive: true
    });
    expect(modelServer.post).not.toHaveBeenCalled(); // never reaches model server
  });

  test('successful query → 200 with answer, model server called with its time budget', async () => {
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
      expect.objectContaining({
        query: 'Where are the pyramids?',
        top_k: 5,
        document: 'egyptian_history',
        // Cooperative cancel — the model server stops issuing LLM calls
        // once the answer can't arrive inside the backend's own window.
        timeout_ms: 290000
      }),
      expect.objectContaining({ timeout: 300000 })
    );
  });

  test('explicit document field is forwarded to the model server', async () => {
    modelServer.post.mockResolvedValue({
      data: { response: { answer: 'ok', sources: [] } }
    });

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi', document: 'pharaohs' });

    expect(res.status).toBe(200);
    expect(modelServer.post).toHaveBeenCalledWith(
      '/query',
      expect.objectContaining({ document: 'pharaohs' }),
      expect.anything()
    );
  });

  test('unsafe document name → 400, model server not called', async () => {
    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi', document: '../secrets' });

    expect(res.status).toBe(400);
    expect(modelServer.post).not.toHaveBeenCalled();
  });

  test('model server success:false → 502, nothing persisted', async () => {
    Conversation.findOne.mockResolvedValue({
      _id: '64b7f0f4c2a1d3e5f6071829',
      userId: 'user-1',
      isActive: true
    });
    modelServer.post.mockResolvedValue({
      data: { success: false, error: 'generation exploded' }
    });

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi', conversationId: '64b7f0f4c2a1d3e5f6071829' });

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/generation exploded/);
    expect(Message.create).not.toHaveBeenCalled();
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

  test('model server 504 (time budget blown mid-pipeline) → 504, not 502', async () => {
    modelServer.post.mockRejectedValue({
      message: 'Request failed with status code 504',
      response: { status: 504, data: { success: false, error: 'time budget exhausted before answer generation' } }
    });

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi' });

    expect(res.status).toBe(504);
    expect(res.body.message).toBe('time budget exhausted before answer generation');
    expect(Message.create).not.toHaveBeenCalled();
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

  test('model server structured error field is surfaced → 502', async () => {
    modelServer.post.mockRejectedValue({
      message: 'Request failed with status code 500',
      response: { status: 500, data: { error: 'retriever offline' } }
    });

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi' });

    expect(res.status).toBe(502);
    expect(res.body.message).toBe('retriever offline');
  });
});

describe('GET /api/documents', () => {
  test('response includes filenames/sizes but never absolute paths', async () => {
    mockDataFiles('data', 'vector_store', 'doc_vectors.npz'); // dirs + index artifacts "exist"
    jest.spyOn(fs, 'readdirSync').mockImplementation((dir) =>
      String(dir).includes('vector_store')
        ? ['doc_metadata.json', 'lonely_metadata.json']
        : ['doc.pdf', 'lonely.pdf']
    );
    jest.spyOn(fs, 'statSync').mockReturnValue({
      mtime: new Date('2025-01-01T00:00:00Z'),
      size: 1234
    });

    const res = await request(app)
      .get('/api/documents')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(2);
    const doc = res.body.documents.find((d) => d.filename === 'doc.pdf');
    const lonely = res.body.documents.find((d) => d.filename === 'lonely.pdf');
    // indexed requires BOTH *_metadata.json and *_vectors.npz
    expect(doc.indexed).toBe(true);
    expect(lonely.indexed).toBe(false);
    expect(doc.size).toBe(1234);
    expect(doc.path).toBeUndefined();
  });
});
