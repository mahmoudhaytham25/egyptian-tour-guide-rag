/**
 * Tests for routes/api.js + controllers/ragController.js.
 *
 * Mocked: mongoose models (User/Conversation/Message), axios (calls to the
 * Flask model server), child_process.spawn (the Python indexer), and
 * fs.existsSync is spied on per-test to simulate uploaded PDFs.
 */
process.env.JWT_SECRET = 'test-jwt-secret';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const request = require('supertest');

jest.mock('../models/user', () => require('./mockFactories').makeUserModel());
jest.mock('../models/conversation', () => require('./mockFactories').makeConversationModel());
jest.mock('../models/message', () => require('./mockFactories').makeMessageModel());
jest.mock('axios');
jest.mock('child_process', () => ({ spawn: jest.fn() }));

const axios = require('axios');
const { spawn } = require('child_process');
const User = require('../models/user');
const Conversation = require('../models/conversation');
const { buildApp, authHeader } = require('./helpers');

const app = buildApp();
const AUTH = authHeader();

/** A fake ChildProcess: EventEmitter with stdout/stderr emitters. */
function fakeProcess() {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  p.kill = jest.fn();
  return p;
}

let spawnedProcs;

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockResolvedValue({ _id: 'user-1', email: 'a@b.com' });
  spawnedProcs = [];
  spawn.mockImplementation(() => {
    const p = fakeProcess();
    spawnedProcs.push(p);
    return p;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.PYTHON_BIN;
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

/** Emit a clean exit so module-level indexingStatus is reset. */
function finishIndexing(proc, code = 0) {
  proc.emit('close', code);
}

describe('POST /api/index — filename validation', () => {
  test("filename 'test.pdf' is accepted → 202 and indexer spawned", async () => {
    mockDataFiles('test.pdf');

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(202);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawn.mock.calls[0];
    expect(cmd).toBe('python3'); // default interpreter
    expect(args[0]).toMatch(/rag[\\/]indexer\.py$/);
    expect(args[1].endsWith(path.join('data', 'test.pdf'))).toBe(true);

    finishIndexing(spawnedProcs[0], 0);
  });

  test("path traversal '../etc/passwd' → 400, indexer not spawned", async () => {
    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: '../etc/passwd' });

    expect(res.status).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("nested path 'a/b.pdf' → 400 (path.basename sanitization)", async () => {
    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'a/b.pdf' });

    expect(res.status).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("non-PDF filename 'notes.txt' → 400", async () => {
    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'notes.txt' });

    expect(res.status).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  test('missing filename → 400', async () => {
    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({});

    expect(res.status).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  test('PDF not in data dir → 404', async () => {
    mockDataFiles('other.pdf'); // 'ghost.pdf' does not "exist"

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'ghost.pdf' });

    expect(res.status).toBe(404);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('POST /api/index — indexer process handling', () => {
  test('uses PYTHON_BIN env var when set', async () => {
    process.env.PYTHON_BIN = 'custom-python';
    mockDataFiles('test.pdf');

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(202);
    expect(spawn.mock.calls[0][0]).toBe('custom-python');

    finishIndexing(spawnedProcs[0], 0);
  });

  test('409 while indexing is already in progress', async () => {
    mockDataFiles('test.pdf');

    await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' }); // leaves isIndexing = true

    const res = await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(409);

    finishIndexing(spawnedProcs[0], 0);
  });

  test("spawn ENOENT falls back to 'python'; failure there resets indexing status", async () => {
    mockDataFiles('test.pdf');

    await request(app)
      .post('/api/index')
      .set('Authorization', AUTH)
      .send({ filename: 'test.pdf' });

    // python3 is missing → controller should fall back to 'python'
    spawnedProcs[0].emit('error', Object.assign(new Error('spawn python3 ENOENT'), { code: 'ENOENT' }));
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1][0]).toBe('python');

    // 'python' also missing → indexing status must be reset with an error
    spawnedProcs[1].emit('error', Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' }));

    const status = await request(app)
      .get('/api/indexing-status')
      .set('Authorization', AUTH);

    expect(status.status).toBe(200);
    expect(status.body.status.isIndexing).toBe(false);
    expect(status.body.status.error).toMatch(/python/);
  });
});

describe('multer upload config', () => {
  test('50MB fileSize limit is configured', () => {
    // The multer instance is not exported; assert the config in source.
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'api.js'), 'utf8');
    expect(src).toMatch(/fileSize:\s*50\s*\*\s*1024\s*\*\s*1024/);
  });

  test('non-PDF upload is rejected by fileFilter', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', AUTH)
      .attach('pdf', Buffer.from('not a pdf'), {
        filename: 'evil.txt',
        contentType: 'text/plain'
      });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Only PDF files are allowed/);
  });
});

describe('POST /api/query', () => {
  test('missing question → 400', async () => {
    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({});

    expect(res.status).toBe(400);
  });

  test('conversationId that does not exist → 404', async () => {
    Conversation.findById.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi', conversationId: 'conv-x' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Conversation not found');
  });

  test('conversationId owned by another user → 403', async () => {
    Conversation.findById.mockResolvedValue({
      _id: 'conv-9',
      userId: 'someone-else', // ≠ req.userId ('user-1')
      save: jest.fn()
    });

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi', conversationId: 'conv-9' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/do not have access/);
    expect(axios.post).not.toHaveBeenCalled(); // never reaches model server
  });

  test('successful query → 200 with answer, axios called with 120s timeout', async () => {
    axios.post.mockResolvedValue({
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

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/query$/),
      expect.objectContaining({ query: 'Where are the pyramids?', top_k: 5 }),
      expect.objectContaining({ timeout: 120000 })
    );
  });

  test('model server timeout → 504', async () => {
    axios.post.mockRejectedValue(
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
    axios.post.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi' });

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/unreachable/i);
  });

  test('model server error response → 502', async () => {
    axios.post.mockRejectedValue({
      message: 'Request failed with status code 500',
      response: { status: 500, data: 'internal error' }
    });

    const res = await request(app)
      .post('/api/query')
      .set('Authorization', AUTH)
      .send({ question: 'hi' });

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/Error generating response/);
  });
});
