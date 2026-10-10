/**
 * Tests for routes/chat.js + controllers/chatController.js.
 * Mongoose Conversation/Message models are mocked.
 *
 * Route :id params are guarded by mongoose.isValidObjectId → tests use real
 * 24-hex ObjectId strings where the id must pass validation.
 */
const request = require('supertest');

jest.mock('../models/user', () => require('./mockFactories').makeUserModel());
jest.mock('../models/conversation', () => require('./mockFactories').makeConversationModel());
jest.mock('../models/message', () => require('./mockFactories').makeMessageModel());

const Conversation = require('../models/conversation');
const Message = require('../models/message');
const { buildApp, authHeader, sortedLimited, mockAuthUser } = require('./helpers');

const app = buildApp();

const CONV_ID = '64b7f0f4c2a1d3e5f6071829';
const OTHER_CONV_ID = '64b7f0f4c2a1d3e5f6071830';

beforeEach(() => {
  jest.clearAllMocks();
  // Auth middleware: resolve the Bearer token to this user (req.userId = 'user-1')
  mockAuthUser({ _id: 'user-1', email: 'a@b.com' });
  Conversation.updateOne.mockResolvedValue({});
  // getConversation queries messages in parallel with the conversation
  // lookup — the chain must exist even when the conversation 404s.
  Message.find.mockReturnValue(sortedLimited([]));
});

describe('POST /api/chat/conversations', () => {
  test('creates a conversation scoped to the authenticated user', async () => {
    const res = await request(app)
      .post('/api/chat/conversations')
      .set('Authorization', authHeader())
      .send({ title: 'Trip planning' });

    expect(res.status).toBe(201);
    expect(Conversation).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', title: 'Trip planning' })
    );
  });

  test('defaults title to "New Conversation"', async () => {
    const res = await request(app)
      .post('/api/chat/conversations')
      .set('Authorization', authHeader())
      .send({});

    expect(res.status).toBe(201);
    expect(Conversation).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', title: 'New Conversation' })
    );
  });

  test('creates an initial Message when body.message is provided', async () => {
    const res = await request(app)
      .post('/api/chat/conversations')
      .set('Authorization', authHeader())
      .send({ message: 'Tell me about the pyramids' });

    expect(res.status).toBe(201);
    expect(Message).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        role: 'user',
        content: 'Tell me about the pyramids'
      })
    );
  });

  test('derives the title from the first message in a single save', async () => {
    const res = await request(app)
      .post('/api/chat/conversations')
      .set('Authorization', authHeader())
      .send({ message: 'Tell me about the pyramids' });

    expect(res.status).toBe(201);
    // Title derived before the first save — no second conversation write.
    expect(Conversation).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Tell me about the pyramids' })
    );
  });

  test('non-string title → 400', async () => {
    const res = await request(app)
      .post('/api/chat/conversations')
      .set('Authorization', authHeader())
      .send({ title: 42 });

    expect(res.status).toBe(400);
    expect(Conversation).not.toHaveBeenCalled();
  });
});

describe('GET /api/chat/conversations', () => {
  test('lists only conversations owned by req.userId, newest first, bounded', async () => {
    const limit = jest.fn().mockResolvedValue([{ _id: 'conv-1', title: 'A' }]);
    const sort = jest.fn().mockReturnValue({ limit });
    Conversation.find.mockReturnValue({ sort });

    const res = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    // The query must be scoped to the authenticated user and active docs
    expect(Conversation.find).toHaveBeenCalledWith({
      userId: 'user-1',
      isActive: true
    });
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(limit).toHaveBeenCalledWith(50);
    expect(res.body).toEqual([{ _id: 'conv-1', title: 'A' }]);
  });
});

describe('GET /api/chat/conversations/:id', () => {
  test('returns conversation + messages when owned by user', async () => {
    Conversation.findOne.mockResolvedValue({ _id: CONV_ID, userId: 'user-1' });
    Message.find.mockReturnValue(sortedLimited([{ role: 'user', content: 'hi' }]));

    const res = await request(app)
      .get(`/api/chat/conversations/${CONV_ID}`)
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    // Soft-deleted conversations are invisible to every route.
    expect(Conversation.findOne).toHaveBeenCalledWith({
      _id: CONV_ID,
      userId: 'user-1',
      isActive: true
    });
    expect(res.body.messages).toHaveLength(1);
  });

  test('conversation owned by another user / missing → 404', async () => {
    Conversation.findOne.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/chat/conversations/${OTHER_CONV_ID}`)
      .set('Authorization', authHeader());

    expect(res.status).toBe(404);
  });

  test('malformed :id → 400 (no CastError 500)', async () => {
    const res = await request(app)
      .get('/api/chat/conversations/not-an-objectid')
      .set('Authorization', authHeader());

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid conversation id/i);
    expect(Conversation.findOne).not.toHaveBeenCalled();
  });
});

describe('POST /api/chat/conversations/:id/messages', () => {
  test('adds a message to an owned conversation', async () => {
    Conversation.findOne.mockResolvedValue({ _id: CONV_ID, userId: 'user-1' });

    const res = await request(app)
      .post(`/api/chat/conversations/${CONV_ID}/messages`)
      .set('Authorization', authHeader())
      .send({ role: 'user', content: 'When was Giza built?' });

    expect(res.status).toBe(201);
    expect(Message).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONV_ID,
        role: 'user',
        content: 'When was Giza built?'
      })
    );
    // Timestamp bump goes through updateOne — no full conversation save.
    expect(Conversation.updateOne).toHaveBeenCalledWith(
      { _id: CONV_ID },
      { $set: { updatedAt: expect.any(Date) } }
    );
  });

  test('missing content → 400', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${CONV_ID}/messages`)
      .set('Authorization', authHeader())
      .send({ role: 'user' }); // no content

    expect(res.status).toBe(400);
  });

  test('role outside the user/assistant enum → 400, not a 500', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${CONV_ID}/messages`)
      .set('Authorization', authHeader())
      .send({ role: 'system', content: 'hi' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/role/i);
    expect(Message).not.toHaveBeenCalled();
  });

  test('content over the length cap → 400', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${CONV_ID}/messages`)
      .set('Authorization', authHeader())
      .send({ role: 'user', content: 'x'.repeat(4001) });

    expect(res.status).toBe(400);
  });

  test('conversation not found → 404', async () => {
    Conversation.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/chat/conversations/${OTHER_CONV_ID}/messages`)
      .set('Authorization', authHeader())
      .send({ role: 'user', content: 'hi' });

    expect(res.status).toBe(404);
  });

  test('metadata keys with dots → 400', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${CONV_ID}/messages`)
      .set('Authorization', authHeader())
      .send({ role: 'user', content: 'hi', metadata: { 'a.b': 1 } });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not allowed/i);
    expect(Message).not.toHaveBeenCalled();
  });

  test('metadata keys with $ prefix → 400', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${CONV_ID}/messages`)
      .set('Authorization', authHeader())
      .send({ role: 'user', content: 'hi', metadata: { $where: 'x' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not allowed/i);
  });

  test('prototype-polluting metadata key → 400', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${CONV_ID}/messages`)
      .set('Authorization', authHeader())
      .send({ role: 'user', content: 'hi', metadata: JSON.parse('{"__proto__": {"x": 1}}') });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not allowed/i);
  });

  test('metadata over the 8KB cap → 400', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${CONV_ID}/messages`)
      .set('Authorization', authHeader())
      .send({ role: 'user', content: 'hi', metadata: { blob: 'x'.repeat(9000) } });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too large/i);
  });
});

describe('PUT /api/chat/conversations/:id', () => {
  test('renames an owned conversation', async () => {
    const save = jest.fn().mockResolvedValue(true);
    Conversation.findOne.mockResolvedValue({ _id: CONV_ID, userId: 'user-1', save });

    const res = await request(app)
      .put(`/api/chat/conversations/${CONV_ID}`)
      .set('Authorization', authHeader())
      .send({ title: '  New title  ' });

    expect(res.status).toBe(200);
    expect(save).toHaveBeenCalled();
  });

  test('empty PUT body → 400 (no silent updatedAt bump)', async () => {
    const res = await request(app)
      .put(`/api/chat/conversations/${CONV_ID}`)
      .set('Authorization', authHeader())
      .send({});

    expect(res.status).toBe(400);
    expect(Conversation.findOne).not.toHaveBeenCalled();
  });

  test('blank title → 400', async () => {
    const res = await request(app)
      .put(`/api/chat/conversations/${CONV_ID}`)
      .set('Authorization', authHeader())
      .send({ title: '   ' });

    expect(res.status).toBe(400);
  });
});
