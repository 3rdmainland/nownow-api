import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';
import { makeOrganizerUser } from '../fixtures/index.js';
import { buildApp, generateToken } from '../helpers/app.js';

// ── Module mocks (must be at top level) ──────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock }));

vi.mock('../../lib/redis.js', () => ({
  default: redisMock,
  redis: redisMock,
  cache: cacheMock,
  CACHE_TTL: CACHE_TTL_MOCK,
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$10$hashed_password_for_testing'),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn().mockReturnValue('test-organizer-nanoid-predictable!!'),
}));

import organizerAuthController from '../../organizer/organizer-auth.controller.js';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Organizer Auth — Rate Limiting (boundary conditions)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    redisMock.incr.mockResolvedValue(1);
    redisMock.expire.mockResolvedValue(1);
    redisMock.del.mockResolvedValue(1);

    process.env.ORGANIZER_ADMIN_SECRET = 'test-admin-secret';

    app = await buildApp(async (a) => {
      await a.register(organizerAuthController, { prefix: '/organizer/auth' });
    });
  });

  // ── Redis key format ───────────────────────────────────────────────────

  describe('rate limit key format', () => {
    it('uses "organizer:login:{email}" as the Redis key', async () => {
      const user = makeOrganizerUser({ email: 'keytest@test.com' });
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'keytest@test.com', password: 'pass' },
      });

      expect(redisMock.incr).toHaveBeenCalledWith('organizer:login:keytest@test.com');
    });
  });

  // ── Expire on first attempt ────────────────────────────────────────────

  describe('TTL window initialization', () => {
    it('sets expire with 900s (15 min) on the first attempt (incr returns 1)', async () => {
      redisMock.incr.mockResolvedValue(1); // first attempt

      const user = makeOrganizerUser({ email: 'ttl@test.com' });
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'ttl@test.com', password: 'pass' },
      });

      expect(redisMock.expire).toHaveBeenCalledWith('organizer:login:ttl@test.com', 900);
    });

    it('does NOT call expire on subsequent attempts (incr returns > 1)', async () => {
      redisMock.incr.mockResolvedValue(5); // fifth attempt

      const user = makeOrganizerUser({ email: 'ttl2@test.com' });
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'ttl2@test.com', password: 'pass' },
      });

      expect(redisMock.expire).not.toHaveBeenCalled();
    });
  });

  // ── Boundary at exactly 20 attempts ────────────────────────────────────

  describe('boundary: exactly 20 vs 21 attempts', () => {
    it('allows login at exactly 20 attempts (the limit)', async () => {
      redisMock.incr.mockResolvedValue(20);

      const user = makeOrganizerUser({ email: 'boundary@test.com' });
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'boundary@test.com', password: 'pass' },
      });

      // 20 attempts = exactly at limit, should still be allowed
      expect(res.statusCode).toBe(200);
    });

    it('rejects login at 21 attempts (one over the limit)', async () => {
      redisMock.incr.mockResolvedValue(21);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'boundary@test.com', password: 'pass' },
      });

      expect(res.statusCode).toBe(429);
      expect(res.json().error).toContain('Too many login attempts');
    });

    it('rejects login at a very high attempt count', async () => {
      redisMock.incr.mockResolvedValue(1000);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'boundary@test.com', password: 'pass' },
      });

      expect(res.statusCode).toBe(429);
    });
  });

  // ── Rate limit clears on success ───────────────────────────────────────

  describe('rate limit reset on successful login', () => {
    it('calls redis.del to clear the rate key after successful login', async () => {
      redisMock.incr.mockResolvedValue(15); // below limit

      const user = makeOrganizerUser({ email: 'clearme@test.com' });
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'clearme@test.com', password: 'pass' },
      });

      expect(res.statusCode).toBe(200);
      expect(redisMock.del).toHaveBeenCalledWith('organizer:login:clearme@test.com');
    });

    it('does NOT clear rate key when login fails (wrong password)', async () => {
      redisMock.incr.mockResolvedValue(5);

      const user = makeOrganizerUser({ email: 'noclear@test.com' });
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'noclear@test.com', password: 'wrong' },
      });

      expect(res.statusCode).toBe(401);
      expect(redisMock.del).not.toHaveBeenCalled();
    });

    it('does NOT clear rate key when login fails (user not found)', async () => {
      redisMock.incr.mockResolvedValue(5);

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'ghost@test.com', password: 'pass' },
      });

      expect(res.statusCode).toBe(401);
      expect(redisMock.del).not.toHaveBeenCalled();
    });
  });

  // ── Per-email isolation ────────────────────────────────────────────────

  describe('per-email isolation', () => {
    it('rate limits are scoped per email — different emails have independent counters', async () => {
      // First email: 5 attempts (OK)
      redisMock.incr.mockResolvedValue(5);
      const user1 = makeOrganizerUser({ email: 'user1@test.com' });
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user1, error: null }),
      );

      const res1 = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'user1@test.com', password: 'pass' },
      });
      expect(res1.statusCode).toBe(200);
      expect(redisMock.incr).toHaveBeenCalledWith('organizer:login:user1@test.com');

      vi.clearAllMocks();
      redisMock.incr.mockResolvedValue(21);

      // Second email: 21 attempts (rate limited)
      const res2 = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'user2@test.com', password: 'pass' },
      });
      expect(res2.statusCode).toBe(429);
      expect(redisMock.incr).toHaveBeenCalledWith('organizer:login:user2@test.com');
    });
  });

  // ── Rate limit fires before password check ────────────────────────────

  describe('rate limit evaluation order', () => {
    it('returns 429 before attempting password verification when over limit', async () => {
      redisMock.incr.mockResolvedValue(25);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'order@test.com', password: 'pass' },
      });

      expect(res.statusCode).toBe(429);
      // bcrypt.compare should NOT have been called since rate limit fires first
      expect(bcrypt.compare).not.toHaveBeenCalled();
      // supabase should NOT have been called for user lookup
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });
  });
});
