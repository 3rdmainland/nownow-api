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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fixture factory for organizer invite (uses organizer_invites table fields).
 */
function makeOrganizerInvite(overrides: Record<string, any> = {}) {
  return {
    id: 'org-invite-id',
    email: 'organizer@test.com',
    token: 'organizer-invite-token-32chars!!!',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    used_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Configure supabaseMock.from to respond with sequential mocks.
 */
function mockFromSequence(
  responses: Array<ReturnType<typeof createSupabaseMock>>,
) {
  let callIndex = 0;
  supabaseMock.from.mockImplementation(() => {
    const mock = responses[callIndex] ?? createSupabaseMock({ data: null, error: null });
    callIndex++;
    return mock;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Organizer Auth Controller — Integration', () => {
  let app: FastifyInstance;

  // Reset the ORGANIZER_ADMIN_SECRET for tests that need it
  const TEST_ADMIN_SECRET = 'test-admin-secret-key';

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset shared redis mock defaults after vi.clearAllMocks()
    redisMock.incr.mockResolvedValue(1);
    redisMock.expire.mockResolvedValue(1);
    redisMock.del.mockResolvedValue(1);

    process.env.ORGANIZER_ADMIN_SECRET = TEST_ADMIN_SECRET;

    app = await buildApp(async (a) => {
      await a.register(organizerAuthController, { prefix: '/organizer/auth' });
    });
  });

  // ── POST /organizer/auth/login ──────────────────────────────────────────────

  describe('POST /organizer/auth/login', () => {
    it('returns 200, sets token cookie, and returns organizer user on success', async () => {
      const user = makeOrganizerUser({ email: 'organizer@test.com' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'organizer@test.com', password: 'correctpassword' },
      });

      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.user).toMatchObject({
        id: user.id,
        email: 'organizer@test.com',
        name: user.name,
      });
      expect(body.user).not.toHaveProperty('passwordHash');
      expect(body.user).not.toHaveProperty('password_hash');

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toMatch(/token=/);
      expect(cookieStr).toMatch(/HttpOnly/i);
    });

    it('returns 401 when organizer email is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'ghost@test.com', password: 'anypassword' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Invalid email or password' });
    });

    it('returns 401 when password is incorrect', async () => {
      const user = makeOrganizerUser();

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: user.email, password: 'wrongpassword' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Invalid email or password' });
    });

    it('returns 429 when login attempts exceed the rate limit', async () => {
      // Simulate 21 attempts (threshold is 20)
      redisMock.incr.mockResolvedValue(21);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'organizer@test.com', password: 'anypassword' },
      });

      expect(res.statusCode).toBe(429);
      expect(res.json()).toMatchObject({ error: 'Too many login attempts, try again in 15 minutes' });
    });

    it('clears the rate-limit key after a successful login', async () => {
      const user = makeOrganizerUser({ email: 'organizer@test.com' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      await app.inject({
        method: 'POST',
        url: '/organizer/auth/login',
        payload: { email: 'organizer@test.com', password: 'correctpassword' },
      });

      expect(redisMock.del).toHaveBeenCalledWith('organizer:login:organizer@test.com');
    });
  });

  // ── GET /organizer/auth/me ──────────────────────────────────────────────────

  describe('GET /organizer/auth/me', () => {
    it('returns 200 with organizer user when valid organizer JWT cookie is present', async () => {
      const user = makeOrganizerUser({ id: 'org-me-id', email: 'me@organizer.com' });

      const token = generateToken(app, {
        userId: user.id,
        email: user.email,
        role: 'organizer',
      });

      const dbRow = {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at,
        updated_at: user.updated_at,
      };

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbRow, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/organizer/auth/me',
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user).toMatchObject({
        id: user.id,
        email: 'me@organizer.com',
        name: user.name,
      });
    });

    it('returns 401 when no cookie is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/organizer/auth/me',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when a vendor JWT is used (wrong role)', async () => {
      // A vendor JWT has role='vendor', not 'organizer'
      const vendorToken = generateToken(app, {
        userId: 'vendor-user-id',
        vendorId: 'some-vendor-id',
        email: 'vendor@test.com',
        role: 'vendor',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/organizer/auth/me',
        headers: { cookie: `token=${vendorToken}` },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Access denied' });
    });

    it('returns 401 when JWT is malformed', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/organizer/auth/me',
        headers: { cookie: 'token=this.is.not.valid.jwt' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when organizer is not found in the database', async () => {
      const token = generateToken(app, {
        userId: 'deleted-org-id',
        email: 'deleted@organizer.com',
        role: 'organizer',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/organizer/auth/me',
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'User not found' });
    });

    it('refreshes the JWT cookie on every /me call (sliding session)', async () => {
      const user = makeOrganizerUser({ id: 'sliding-session-user' });

      const token = generateToken(app, {
        userId: user.id,
        email: user.email,
        role: 'organizer',
      });

      const dbRow = {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at,
        updated_at: user.updated_at,
      };

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbRow, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/organizer/auth/me',
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(200);
      // A new cookie must be set on every /me call
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
    });
  });

  // ── POST /organizer/auth/register ───────────────────────────────────────────

  describe('POST /organizer/auth/register', () => {
    it('returns 201, sets token cookie, and returns user on success', async () => {
      const invite = makeOrganizerInvite({ email: 'new-org@test.com' });
      const newUser = makeOrganizerUser({ email: 'new-org@test.com', name: 'Alice' });

      const insertedRow = {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        created_at: newUser.created_at,
        updated_at: newUser.updated_at,
      };

      mockFromSequence([
        createSupabaseMock({ data: invite, error: null }),                            // get invite
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),            // check existing user
        createSupabaseMock({ data: insertedRow, error: null }),                       // insert user
        createSupabaseMock({ data: null, error: null }),                              // mark invite used
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/register',
        payload: {
          token: invite.token,
          password: 'securepassword123',
          name: 'Alice',
        },
      });

      expect(res.statusCode).toBe(201);

      const body = res.json();
      expect(body.user).toMatchObject({
        id: newUser.id,
        email: 'new-org@test.com',
        name: 'Alice',
      });
      expect(body.user).not.toHaveProperty('passwordHash');

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toMatch(/token=/);
      expect(cookieStr).toMatch(/HttpOnly/i);
    });

    it('returns 400 when invite token is invalid', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/register',
        payload: {
          token: 'bad-invite-token',
          password: 'securepassword123',
          name: 'Bob',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Invalid invite token' });
    });

    it('returns 400 when invite token has expired', async () => {
      const invite = makeOrganizerInvite({
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        used_at: null,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: invite, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/register',
        payload: {
          token: invite.token,
          password: 'securepassword123',
          name: 'Bob',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Invite has expired' });
    });

    it('returns 409 when email is already registered as an organizer', async () => {
      const invite = makeOrganizerInvite({ email: 'duplicate@test.com' });
      const existingUser = makeOrganizerUser({ email: 'duplicate@test.com' });

      mockFromSequence([
        createSupabaseMock({ data: invite, error: null }),
        createSupabaseMock({ data: existingUser, error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/register',
        payload: {
          token: invite.token,
          password: 'securepassword123',
          name: 'Duplicate',
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'Email already registered' });
    });

    it('returns 400 when password is too short', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/register',
        payload: { token: 'some-token', password: 'short', name: 'Alice' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /organizer/auth/change-password ────────────────────────────────────

  describe('POST /organizer/auth/change-password', () => {
    it('returns 200 on success with a valid organizer JWT and correct current password', async () => {
      const user = makeOrganizerUser({ id: 'org-pw-change-user' });

      const token = generateToken(app, {
        userId: user.id,
        email: user.email,
        role: 'organizer',
      });

      mockFromSequence([
        createSupabaseMock({ data: { id: user.id, password_hash: user.password_hash }, error: null }),
        createSupabaseMock({ data: null, error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/change-password',
        headers: { cookie: `token=${token}` },
        payload: { currentPassword: 'currentpassword', newPassword: 'newpassword123' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ message: 'Password changed successfully' });

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 10);
    });

    it('returns 401 when no cookie is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/change-password',
        payload: { currentPassword: 'old', newPassword: 'newpassword123' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when a vendor JWT is used instead of an organizer JWT', async () => {
      const vendorToken = generateToken(app, {
        userId: 'vendor-user-id',
        vendorId: 'some-vendor',
        email: 'vendor@test.com',
        role: 'vendor',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/change-password',
        headers: { cookie: `token=${vendorToken}` },
        payload: { currentPassword: 'old', newPassword: 'newpassword123' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Access denied' });
    });

    it('returns 401 when current password is wrong', async () => {
      const user = makeOrganizerUser({ id: 'org-wrong-pw-user' });

      const token = generateToken(app, {
        userId: user.id,
        email: user.email,
        role: 'organizer',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: { id: user.id, password_hash: user.password_hash }, error: null }),
      );

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/change-password',
        headers: { cookie: `token=${token}` },
        payload: { currentPassword: 'wrongcurrent', newPassword: 'newpassword123' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Current password is incorrect' });
    });
  });

  // ── POST /organizer/auth/logout ─────────────────────────────────────────────

  describe('POST /organizer/auth/logout', () => {
    it('returns 200 and clears the token cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/logout',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ message: 'Logged out' });

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toMatch(/token=/);
      expect(cookieStr).toMatch(/Max-Age=0|token=;/i);
    });
  });

  // ── POST /organizer/auth/invite ─────────────────────────────────────────────

  describe('POST /organizer/auth/invite', () => {
    it('returns 201 with inviteToken when X-Admin-Key is correct', async () => {
      mockFromSequence([
        createSupabaseMock({ data: null, error: { message: 'No rows' } }), // no existing user
        createSupabaseMock({ data: null, error: null }),                    // insert invite
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/invite',
        headers: { 'x-admin-key': TEST_ADMIN_SECRET },
        payload: { email: 'neworgnizer@test.com' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        inviteToken: 'test-organizer-nanoid-predictable!!',
        expiresAt: expect.any(String),
      });
    });

    it('returns 401 when X-Admin-Key is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/invite',
        payload: { email: 'neworgnizer@test.com' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Unauthorized' });
    });

    it('returns 401 when X-Admin-Key is wrong', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/invite',
        headers: { 'x-admin-key': 'wrong-secret' },
        payload: { email: 'neworgnizer@test.com' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Unauthorized' });
    });

    it('returns 409 when organizer email already exists', async () => {
      const existingUser = makeOrganizerUser({ email: 'existing@test.com' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: existingUser, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/invite',
        headers: { 'x-admin-key': TEST_ADMIN_SECRET },
        payload: { email: 'existing@test.com' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'An organizer with this email already exists' });
    });
  });

  // ── POST /organizer/auth/forgot-password ────────────────────────────────────

  describe('POST /organizer/auth/forgot-password', () => {
    it('always returns 200 with the same message to prevent email enumeration', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/forgot-password',
        payload: { email: 'unknown@test.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        message: 'If that email exists, a reset link has been sent',
      });
    });

    it('returns 200 and generates a token when email exists', async () => {
      const user = makeOrganizerUser({ email: 'known@test.com' });

      mockFromSequence([
        createSupabaseMock({ data: { id: user.id }, error: null }),
        createSupabaseMock({ data: null, error: null }), // invalidate old tokens
        createSupabaseMock({ data: null, error: null }), // insert new token
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/forgot-password',
        payload: { email: 'known@test.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        message: 'If that email exists, a reset link has been sent',
      });
    });
  });

  // ── POST /organizer/auth/reset-password ─────────────────────────────────────

  describe('POST /organizer/auth/reset-password', () => {
    it('returns 200 on a valid, unused, non-expired reset token', async () => {
      const resetRecord = {
        email: 'organizer@test.com',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        used_at: null,
      };

      mockFromSequence([
        createSupabaseMock({ data: resetRecord, error: null }),
        createSupabaseMock({ data: null, error: null }), // update password
        createSupabaseMock({ data: null, error: null }), // mark token used
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/reset-password',
        payload: { token: 'valid-reset-token', newPassword: 'freshpassword123' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ message: 'Password reset successfully' });
    });

    it('returns 404 when reset token does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/reset-password',
        payload: { token: 'bad-token', newPassword: 'freshpassword123' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Invalid or expired reset token' });
    });

    it('returns 400 when reset token has already been used', async () => {
      const resetRecord = {
        email: 'organizer@test.com',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        used_at: new Date().toISOString(),
      };

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: resetRecord, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/reset-password',
        payload: { token: 'used-token', newPassword: 'freshpassword123' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Reset token has already been used' });
    });
  });

  // ── POST /organizer/auth/admin-reset-password ───────────────────────────────

  describe('POST /organizer/auth/admin-reset-password', () => {
    it('returns 200 when X-Admin-Key is correct and email exists', async () => {
      const user = makeOrganizerUser({ email: 'admin-target@test.com' });

      mockFromSequence([
        createSupabaseMock({ data: { id: user.id }, error: null }),    // find user
        createSupabaseMock({ data: null, error: null }),                // update password
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/admin-reset-password',
        headers: { 'x-admin-key': TEST_ADMIN_SECRET },
        payload: { email: 'admin-target@test.com', newPassword: 'adminsetpassword123' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ message: 'Password reset successfully' });
      expect(bcrypt.hash).toHaveBeenCalledWith('adminsetpassword123', 10);
    });

    it('returns 401 when X-Admin-Key is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/admin-reset-password',
        payload: { email: 'admin-target@test.com', newPassword: 'adminsetpassword123' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 404 when the target email does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/organizer/auth/admin-reset-password',
        headers: { 'x-admin-key': TEST_ADMIN_SECRET },
        payload: { email: 'ghost@test.com', newPassword: 'adminsetpassword123' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Organizer not found' });
    });
  });

  // ── GET /organizer/auth/invite/:token ───────────────────────────────────────

  describe('GET /organizer/auth/invite/:token', () => {
    it('returns 200 with email for a valid invite token', async () => {
      const invite = makeOrganizerInvite({ email: 'invited@test.com' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: invite, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/organizer/auth/invite/${invite.token}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ email: 'invited@test.com' });
    });

    it('returns 404 for an unknown invite token', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/organizer/auth/invite/unknown-token',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Invalid invite token' });
    });

    it('returns 400 for an invite that has already been used', async () => {
      const invite = makeOrganizerInvite({ used_at: new Date().toISOString() });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: invite, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/organizer/auth/invite/${invite.token}`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Invite has already been used' });
    });
  });
});
