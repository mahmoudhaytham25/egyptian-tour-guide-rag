/**
 * Tests for middleware/auth.js — exercised through protected routes on both
 * /api/* (routes/api.js) and /api/chat/* (routes/chat.js).
 */
const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../models/user', () => require('./mockFactories').makeUserModel());
jest.mock('../models/conversation', () => require('./mockFactories').makeConversationModel());
jest.mock('../models/message', () => require('./mockFactories').makeMessageModel());

const User = require('../models/user');
const Conversation = require('../models/conversation');
const { buildApp, authHeader, sortedLimited, mockAuthUser } = require('./helpers');

const app = buildApp();

beforeEach(() => {
  jest.clearAllMocks();
  // Default: authenticated user exists
  mockAuthUser({ _id: 'user-1', email: 'a@b.com' });
  Conversation.find.mockReturnValue(sortedLimited([]));
});

describe('auth middleware — /api/chat/* routes', () => {
  test('missing Authorization header → 401', async () => {
    const res = await request(app).get('/api/chat/conversations');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/no token/i);
  });

  test('malformed Authorization header (no Bearer prefix) → 401', async () => {
    const res = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', 'Token abc123');
    expect(res.status).toBe(401);
  });

  test('invalid Bearer token → 401 Invalid token', async () => {
    const res = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid token');
  });

  test('expired token → 401 Token expired', async () => {
    const expired = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { expiresIn: '-10s' });
    const res = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Token expired');
  });

  test('valid token but user no longer exists → 401', async () => {
    mockAuthUser(null);
    const res = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', authHeader());
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('User not found');
  });

  test('valid token + existing user → passes through to route', async () => {
    const res = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(User.findById).toHaveBeenCalledWith('user-1');
  });
});

describe('auth middleware — /api/* routes', () => {
  test('missing token → 401 on /api/indexing-status', async () => {
    const res = await request(app).get('/api/indexing-status');
    expect(res.status).toBe(401);
  });

  test('invalid token → 401 on /api/query', async () => {
    const res = await request(app)
      .post('/api/query')
      .set('Authorization', 'Bearer garbage')
      .send({ question: 'hi' });
    expect(res.status).toBe(401);
  });

  test('health endpoint is public (no token required)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
