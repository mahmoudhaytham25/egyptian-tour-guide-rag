/**
 * Unit tests for middleware/rateLimit.js — exercised directly (not through
 * the app) because tests/helpers.js sets RATE_LIMIT_DISABLED=true.
 */
const { rateLimit } = require('../middleware/rateLimit');

const req = (ip = '127.0.0.1') => ({ ip });
const res = () => {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
};

afterEach(() => {
  delete process.env.RATE_LIMIT_DISABLED;
});

describe('rateLimit', () => {
  test('allows up to `max` requests per window, then 429s', () => {
    const limiter = rateLimit({ windowMs: 60000, max: 3 });
    const next = jest.fn();

    for (let i = 0; i < 3; i += 1) {
      limiter(req(), res(), next);
    }
    expect(next).toHaveBeenCalledTimes(3);

    const blocked = res();
    limiter(req(), blocked, next);
    expect(next).toHaveBeenCalledTimes(3);
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(blocked.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/too many/i) })
    );
  });

  test('buckets are per-IP', () => {
    const limiter = rateLimit({ windowMs: 60000, max: 1 });
    const next = jest.fn();

    limiter(req('10.0.0.1'), res(), next);
    limiter(req('10.0.0.2'), res(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  test('RATE_LIMIT_DISABLED=true bypasses the limiter', () => {
    process.env.RATE_LIMIT_DISABLED = 'true';
    const limiter = rateLimit({ windowMs: 60000, max: 1 });
    const next = jest.fn();
    const blocked = res();

    limiter(req(), blocked, next);
    limiter(req(), blocked, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(blocked.status).not.toHaveBeenCalled();
  });
});
