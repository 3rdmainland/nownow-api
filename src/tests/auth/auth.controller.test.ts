import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';
import { makeVendor, makeVendorUser, makeInvite } from '../fixtures/index.js';
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
  nanoid: vi.fn().mockReturnValue('test-nanoid-32-chars-predictable!!'),
}));

import authController from '../../auth/auth.controller.js';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Configure supabaseMock.from to respond with different data per sequential call.
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

describe('Auth Controller — Integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp(async (a) => {
      await a.register(authController, { prefix: '/auth' });
    });
  });

  // ── POST /auth/invite ───────────────────────────────────────────────────────

  describe('POST /auth/invite', () => {
    it('returns 201 with inviteToken on success', async () => {
      const vendor = makeVendor();

      mockFromSequence([
        createSupabaseMock({ data: vendor, error: null }),           // vendors lookup
        createSupabaseMock({ data: null, error: { message: 'No rows' } }), // vendor_users (no existing)
        createSupabaseMock({ data: null, error: null }),             // vendor_invites insert
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/invite',
        payload: { vendorId: vendor.id, email: 'newuser@test.com' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({
        inviteToken: 'test-nanoid-32-chars-predictable!!',
        expiresAt: expect.any(String),
      });
    });

    it('returns 404 when vendor does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Not found' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/invite',
        payload: {
          vendorId: '00000000-0000-0000-0000-000000000000',
          email: 'newuser@test.com',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Vendor not found' });
    });

    it('returns 409 when email already has an existing user account', async () => {
      const vendor = makeVendor();
      const existingUser = makeVendorUser({ email: 'taken@test.com' });

      mockFromSequence([
        createSupabaseMock({ data: vendor, error: null }),
        createSupabaseMock({ data: existingUser, error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/invite',
        payload: { vendorId: vendor.id, email: 'taken@test.com' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'A user with this email already exists' });
    });

    it('returns 400 when request body is missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/invite',
        payload: { email: 'missing-vendor-id@test.com' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /auth/invite/:token ─────────────────────────────────────────────────

  describe('GET /auth/invite/:token', () => {
    it('returns 200 with email and vendorName for a valid token', async () => {
      const vendor = makeVendor({ name: 'Spicy Kitchen' });
      const invite = makeInvite({ vendor_id: vendor.id, email: 'user@test.com' });

      mockFromSequence([
        createSupabaseMock({ data: invite, error: null }),  // vendor_invites
        createSupabaseMock({ data: vendor, error: null }),  // vendors
      ]);

      const res = await app.inject({
        method: 'GET',
        url: `/auth/invite/${invite.token}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        email: 'user@test.com',
        vendorName: 'Spicy Kitchen',
      });
    });

    it('returns 404 for an unknown token', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/auth/invite/completely-invalid-token',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Invalid invite token' });
    });

    it('returns 400 when invite has already been used', async () => {
      const invite = makeInvite({ used_at: new Date().toISOString() });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: invite, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/auth/invite/${invite.token}`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Invite has already been used' });
    });
  });

  // ── POST /auth/register ─────────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('returns 201, sets token cookie, and returns user on success', async () => {
      const vendor = makeVendor();
      const invite = makeInvite({ vendor_id: vendor.id, email: 'newuser@test.com' });
      const newUser = makeVendorUser({ vendor_id: vendor.id, email: 'newuser@test.com' });

      const insertedRow = {
        id: newUser.id,
        vendor_id: newUser.vendor_id,
        email: newUser.email,
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
        url: '/auth/register',
        payload: { token: invite.token, password: 'securepassword123' },
      });

      expect(res.statusCode).toBe(201);

      const body = res.json();
      expect(body.user).toMatchObject({
        id: newUser.id,
        email: 'newuser@test.com',
        vendorId: vendor.id,
      });
      expect(body.user).not.toHaveProperty('passwordHash');

      // Should set an httpOnly JWT cookie
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(Array.isArray(setCookie) ? setCookie[0] : setCookie).toMatch(/token=/);
      expect(Array.isArray(setCookie) ? setCookie[0] : setCookie).toMatch(/HttpOnly/i);
    });

    it('returns 400 when invite token has expired', async () => {
      const invite = makeInvite({
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        used_at: null,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: invite, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { token: invite.token, password: 'securepassword123' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Invite has expired' });
    });

    it('returns 400 when invite token is invalid', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { token: 'garbage-token', password: 'securepassword123' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Invalid invite token' });
    });

    it('returns 400 when password is too short', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { token: 'some-token', password: 'short' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 409 when email is already registered', async () => {
      const invite = makeInvite({ email: 'duplicate@test.com' });
      const existingUser = makeVendorUser({ email: 'duplicate@test.com' });

      mockFromSequence([
        createSupabaseMock({ data: invite, error: null }),
        createSupabaseMock({ data: existingUser, error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { token: invite.token, password: 'securepassword123' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'Email already registered' });
    });
  });

  // ── POST /auth/login ────────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('returns 200, sets token cookie, and returns user on success', async () => {
      const user = makeVendorUser({ email: 'login@test.com', vendor_id: 'vendor-123' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'login@test.com', password: 'correctpassword' },
      });

      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.user).toMatchObject({
        id: user.id,
        email: 'login@test.com',
        vendorId: user.vendor_id,
      });
      expect(body.user).not.toHaveProperty('passwordHash');
      expect(body.user).not.toHaveProperty('password_hash');

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(Array.isArray(setCookie) ? setCookie[0] : setCookie).toMatch(/token=/);
      expect(Array.isArray(setCookie) ? setCookie[0] : setCookie).toMatch(/HttpOnly/i);
    });

    it('returns 401 when user is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'ghost@test.com', password: 'somepassword' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Invalid email or password' });
    });

    it('returns 401 when password is incorrect', async () => {
      const user = makeVendorUser({ email: 'user@test.com' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'user@test.com', password: 'wrongpassword' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Invalid email or password' });
    });

    it('returns 400 when request body is missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'user@test.com' }, // missing password
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /auth/logout ───────────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('returns 200 and clears the token cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/logout',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ message: 'Logged out' });

      // The cookie should be cleared (expires immediately)
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieHeader).toMatch(/token=/);
      // Cleared cookies have Max-Age=0 or an empty value
      expect(cookieHeader).toMatch(/Max-Age=0|token=;/i);
    });

    it('returns 200 even without an existing cookie (idempotent)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/logout',
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── GET /auth/me ────────────────────────────────────────────────────────────

  describe('GET /auth/me', () => {
    it('returns 200 with current user when valid JWT cookie is present', async () => {
      const user = makeVendorUser({ id: 'me-user-id', vendor_id: 'my-vendor', email: 'me@test.com' });

      const token = generateToken(app, {
        userId: user.id,
        vendorId: user.vendor_id,
        email: user.email,
        role: 'vendor',
      });

      const dbRow = {
        id: user.id,
        vendor_id: user.vendor_id,
        email: user.email,
        created_at: user.created_at,
        updated_at: user.updated_at,
      };

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbRow, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user).toMatchObject({
        id: user.id,
        email: 'me@test.com',
        vendorId: user.vendor_id,
      });
    });

    it('returns 401 when no cookie is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when JWT is invalid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: 'token=this-is-not-a-valid-jwt' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when user is not found in the database', async () => {
      const token = generateToken(app, {
        userId: 'deleted-user-id',
        vendorId: 'some-vendor',
        email: 'deleted@test.com',
        role: 'vendor',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'User not found' });
    });
  });

  // ── POST /auth/change-password ──────────────────────────────────────────────

  describe('POST /auth/change-password', () => {
    it('returns 401 when no cookie is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/change-password',
        payload: { currentPassword: 'old', newPassword: 'newpassword123' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 200 on success with a valid JWT and correct current password', async () => {
      const user = makeVendorUser({ id: 'change-pw-user-id' });

      const token = generateToken(app, {
        userId: user.id,
        vendorId: user.vendor_id,
        email: user.email,
        role: 'vendor',
      });

      mockFromSequence([
        createSupabaseMock({ data: { id: user.id, password_hash: user.password_hash }, error: null }),
        createSupabaseMock({ data: null, error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/change-password',
        headers: { cookie: `token=${token}` },
        payload: { currentPassword: 'currentpassword', newPassword: 'newpassword123' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ message: 'Password changed successfully' });
    });

    it('returns 401 when current password is wrong', async () => {
      const user = makeVendorUser({ id: 'change-pw-user-id-2' });

      const token = generateToken(app, {
        userId: user.id,
        vendorId: user.vendor_id,
        email: user.email,
        role: 'vendor',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: { id: user.id, password_hash: user.password_hash }, error: null }),
      );

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/change-password',
        headers: { cookie: `token=${token}` },
        payload: { currentPassword: 'wrongcurrent', newPassword: 'newpassword123' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Current password is incorrect' });
    });

    it('returns 400 when newPassword is too short', async () => {
      const user = makeVendorUser();
      const token = generateToken(app, {
        userId: user.id,
        vendorId: user.vendor_id,
        email: user.email,
        role: 'vendor',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/change-password',
        headers: { cookie: `token=${token}` },
        payload: { currentPassword: 'current', newPassword: 'short' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /auth/forgot-password ──────────────────────────────────────────────

  describe('POST /auth/forgot-password', () => {
    it('always returns 200 with the same message regardless of whether email exists', async () => {
      // Email not found — should still return 200
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'ghost@test.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        message: 'If that email exists, a reset link has been sent',
      });
    });

    it('returns 200 and generates a token when email exists', async () => {
      const user = makeVendorUser({ email: 'real@test.com' });

      mockFromSequence([
        createSupabaseMock({ data: { id: user.id }, error: null }),
        createSupabaseMock({ data: null, error: null }), // invalidate old tokens
        createSupabaseMock({ data: null, error: null }), // insert new token
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'real@test.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        message: 'If that email exists, a reset link has been sent',
      });
    });
  });

  // ── POST /auth/reset-password ───────────────────────────────────────────────

  describe('POST /auth/reset-password', () => {
    it('returns 200 on a valid, unused, non-expired token', async () => {
      const resetRecord = {
        email: 'user@test.com',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        used_at: null,
      };

      mockFromSequence([
        createSupabaseMock({ data: resetRecord, error: null }),
        createSupabaseMock({ data: null, error: null }), // update user password
        createSupabaseMock({ data: null, error: null }), // mark token used
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: 'valid-reset-token', newPassword: 'freshpassword123' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ message: 'Password reset successfully' });
    });

    it('returns 404 when reset token is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: 'nonexistent-token', newPassword: 'freshpassword123' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Invalid or expired reset token' });
    });

    it('returns 400 when reset token has already been used', async () => {
      const resetRecord = {
        email: 'user@test.com',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        used_at: new Date().toISOString(),
      };

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: resetRecord, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: 'used-token', newPassword: 'freshpassword123' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Reset token has already been used' });
    });
  });
});
