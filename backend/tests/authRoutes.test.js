/**
 * Tests for routes/auth.js + controllers/authController.js (signup/login).
 * The Mongoose User model and bcryptjs are mocked. Email verification was
 * removed along with the mailer — /api/auth/verify/:token no longer exists.
 */
process.env.JWT_SECRET = 'test-jwt-secret';

const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../models/user', () => require('./mockFactories').makeUserModel());
jest.mock('bcryptjs');

const User = require('../models/user');
const bcrypt = require('bcryptjs');
const { buildApp } = require('./helpers');

const app = buildApp();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/auth/signup', () => {
  test('happy path → 201 with a 12h JWT', async () => {
    User.findOne.mockResolvedValue(null); // email not taken

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'new@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    // Token should decode to the new user's id and expire in 12h
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBe('user-1');
    expect(decoded.email).toBe('new@example.com');
    expect(decoded.exp - decoded.iat).toBe(12 * 3600);
    expect(User.findOne).toHaveBeenCalledWith({ email: 'new@example.com' });
  });

  test('email is normalized (trim + lowercase) before lookup and save', async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: '  New@Example.COM ', password: 'password123' });

    expect(res.status).toBe(201);
    expect(User.findOne).toHaveBeenCalledWith({ email: 'new@example.com' });
    expect(User).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@example.com' })
    );
  });

  test('email already in use → 409', async () => {
    User.findOne.mockResolvedValue({ _id: 'existing', email: 'dup@example.com' });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'dup@example.com', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already in use/i);
  });

  test('malformed email → 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('password under 8 chars → 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'new@example.com', password: 'short1' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 8/i);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('missing password → 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'new@example.com' });

    expect(res.status).toBe(400);
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
      .send({ email: 'a@b.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.userId).toBe('user-1');
    expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashed');
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
      .send({ email: 'a@b.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials.');
  });

  test('unknown email → 401', async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });

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
      .send({ email: 'a@b.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/verify your email/i);
  });

  test('missing password → 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com' });

    expect(res.status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/verify/:token — removed', () => {
  test('authenticated → 404', async () => {
    User.findById.mockResolvedValue({ _id: 'user-1', email: 'a@b.com' });
    const token = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get(`/api/auth/verify/${token}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
