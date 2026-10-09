/**
 * Tests for routes/auth.js + controllers/authController.js (signup/login/verify).
 * Mongoose User model, bcryptjs and the email service are mocked.
 */
process.env.JWT_SECRET = 'test-jwt-secret';

const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../models/user', () => require('./mockFactories').makeUserModel());
jest.mock('bcryptjs');
jest.mock('../services/emailService');

const User = require('../models/user');
const bcrypt = require('bcryptjs');
const { buildApp } = require('./helpers');

const app = buildApp();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/auth/signup', () => {
  test('happy path → 201 with JWT token', async () => {
    User.findOne.mockResolvedValue(null); // email not taken

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'new@example.com', password: 'pw12345' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    // Token should decode to the new user's id
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBe('user-1');
    expect(User.findOne).toHaveBeenCalledWith({ email: 'new@example.com' });
  });

  test('email already in use → 409', async () => {
    User.findOne.mockResolvedValue({ _id: 'existing', email: 'dup@example.com' });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'dup@example.com', password: 'pw12345' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already in use/i);
  });
});

describe('POST /api/auth/login', () => {
  test('happy path → 200 with token and userId', async () => {
    User.findOne.mockResolvedValue({
      _id: 'user-1',
      email: 'a@b.com',
      verified: true,
      password: 'hashed'
    });
    bcrypt.compare.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'pw12345' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.userId).toBe('user-1');
    expect(bcrypt.compare).toHaveBeenCalledWith('pw12345', 'hashed');
  });

  test('wrong password → 401 Invalid credentials', async () => {
    User.findOne.mockResolvedValue({
      _id: 'user-1',
      email: 'a@b.com',
      verified: true,
      password: 'hashed'
    });
    bcrypt.compare.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials.');
  });

  test('unknown email → 401', async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'pw' });

    expect(res.status).toBe(401);
  });

  test('unverified user → 401 Please verify your email', async () => {
    User.findOne.mockResolvedValue({
      _id: 'user-1',
      email: 'a@b.com',
      verified: false,
      password: 'hashed'
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'pw12345' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/verify your email/i);
  });
});

describe('GET /api/auth/verify/:token', () => {
  test('valid token verifies the user', async () => {
    const save = jest.fn().mockResolvedValue(true);
    User.findById.mockResolvedValue({ _id: 'user-1', verified: false, save });
    const token = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app).get(`/api/auth/verify/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified/i);
    expect(save).toHaveBeenCalled();
  });

  test('already-verified user → 200 Already verified', async () => {
    User.findById.mockResolvedValue({ _id: 'user-1', verified: true });
    const token = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET);

    const res = await request(app).get(`/api/auth/verify/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Already verified.');
  });

  test('garbage token → 400', async () => {
    const res = await request(app).get('/api/auth/verify/not.a.jwt');
    expect(res.status).toBe(400);
  });

  test('valid token but user not found → 400', async () => {
    User.findById.mockResolvedValue(null);
    const token = jwt.sign({ id: 'ghost' }, process.env.JWT_SECRET);

    const res = await request(app).get(`/api/auth/verify/${token}`);
    expect(res.status).toBe(400);
  });
});
