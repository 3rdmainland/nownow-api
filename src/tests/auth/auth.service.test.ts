import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';
import { makeVendor, makeVendorUser, makeInvite } from '../fixtures/index.js';

// ── Module mocks (must be at top level) ──────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));

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

// Import after mocks are set up
import { AuthService } from '../../auth/auth.service.js';
import bcrypt from 'bcryptjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Configure supabaseMock.from to respond to sequential table queries.
 * Each call to supabase.from() consumes the next mock in the array.
 */
function mockFromSequence(responses: Array<{ table: string; response: ReturnType<typeof createSupabaseMock> }>) {
  let callIndex = 0;
  supabaseMock.from.mockImplementation((table: string) => {
    const entry = responses[callIndex];
    callIndex++;
    return entry?.response ?? createSupabaseMock({ data: null, error: null });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthService();
  });

  // ── createInvite ────────────────────────────────────────────────────────────

  describe('createInvite', () => {
    it('throws NotFoundError when vendor does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Not found' } }),
      );

      await expect(
        service.createInvite({ vendorId: 'nonexistent-vendor-id', email: 'new@test.com' }),
      ).rejects.toMatchObject({
        name: 'NotFoundError',
        statusCode: 404,
        message: 'Vendor not found',
      });
    });

    it('throws ConflictError when a user with that email already exists', async () => {
      const vendor = makeVendor();
      const existingUser = makeVendorUser({ email: 'taken@test.com' });

      mockFromSequence([
        { table: 'vendors', response: createSupabaseMock({ data: vendor, error: null }) },
        { table: 'vendor_users', response: createSupabaseMock({ data: existingUser, error: null }) },
      ]);

      await expect(
        service.createInvite({ vendorId: vendor.id, email: 'taken@test.com' }),
      ).rejects.toMatchObject({
        name: 'ConflictError',
        statusCode: 409,
        message: 'A user with this email already exists',
      });
    });

    it('returns inviteToken and expiresAt on success', async () => {
      const vendor = makeVendor();

      mockFromSequence([
        { table: 'vendors', response: createSupabaseMock({ data: vendor, error: null }) },
        // no existing user
        { table: 'vendor_users', response: createSupabaseMock({ data: null, error: { message: 'No rows' } }) },
        // insert invite
        { table: 'vendor_invites', response: createSupabaseMock({ data: null, error: null }) },
      ]);

      const result = await service.createInvite({ vendorId: vendor.id, email: 'invite@test.com' });

      expect(result).toMatchObject({
        inviteToken: 'test-nanoid-32-chars-predictable!!',
        expiresAt: expect.any(String),
      });
      // expiresAt should be ~7 days in the future
      const expiresAt = new Date(result.expiresAt).getTime();
      const sevenDaysFromNow = Date.now() + 7 * 24 * 60 * 60 * 1000;
      expect(expiresAt).toBeGreaterThan(Date.now());
      expect(expiresAt).toBeLessThanOrEqual(sevenDaysFromNow + 5000);
    });
  });

  // ── validateInvite ──────────────────────────────────────────────────────────

  describe('validateInvite', () => {
    it('throws NotFoundError when token does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows found' } }),
      );

      await expect(service.validateInvite('bad-token')).rejects.toMatchObject({
        name: 'NotFoundError',
        statusCode: 404,
        message: 'Invalid invite token',
      });
    });

    it('throws ValidationError when invite has already been used', async () => {
      const invite = makeInvite({ used_at: new Date().toISOString() });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: invite, error: null }),
      );

      await expect(service.validateInvite(invite.token)).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invite has already been used',
      });
    });

    it('throws ValidationError when invite has expired', async () => {
      const invite = makeInvite({
        expires_at: new Date(Date.now() - 1000).toISOString(), // 1 second ago
        used_at: null,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: invite, error: null }),
      );

      await expect(service.validateInvite(invite.token)).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invite has expired',
      });
    });

    it('returns email and vendorName on success', async () => {
      const vendor = makeVendor({ name: 'Delicious Eats' });
      const invite = makeInvite({ vendor_id: vendor.id, email: 'user@test.com' });

      mockFromSequence([
        { table: 'vendor_invites', response: createSupabaseMock({ data: invite, error: null }) },
        { table: 'vendors', response: createSupabaseMock({ data: vendor, error: null }) },
      ]);

      const result = await service.validateInvite(invite.token);

      expect(result).toEqual({
        email: 'user@test.com',
        vendorName: 'Delicious Eats',
      });
    });

    it('returns "Unknown Vendor" when vendor lookup fails', async () => {
      const invite = makeInvite({ email: 'user@test.com' });

      mockFromSequence([
        { table: 'vendor_invites', response: createSupabaseMock({ data: invite, error: null }) },
        { table: 'vendors', response: createSupabaseMock({ data: null, error: { message: 'Not found' } }) },
      ]);

      const result = await service.validateInvite(invite.token);

      expect(result.vendorName).toBe('Unknown Vendor');
    });
  });

  // ── register ────────────────────────────────────────────────────────────────

  describe('register', () => {
    it('throws ValidationError when invite token is invalid', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      await expect(
        service.register({ token: 'invalid-token', password: 'password123' }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invalid invite token',
      });
    });

    it('throws ValidationError when invite has already been used', async () => {
      const invite = makeInvite({ used_at: new Date().toISOString() });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: invite, error: null }),
      );

      await expect(
        service.register({ token: invite.token, password: 'password123' }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invite has already been used',
      });
    });

    it('throws ValidationError when invite has expired', async () => {
      const invite = makeInvite({
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        used_at: null,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: invite, error: null }),
      );

      await expect(
        service.register({ token: invite.token, password: 'password123' }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invite has expired',
      });
    });

    it('throws ConflictError when email is already registered', async () => {
      const invite = makeInvite({ email: 'already@test.com' });
      const existingUser = makeVendorUser({ email: 'already@test.com' });

      mockFromSequence([
        { table: 'vendor_invites', response: createSupabaseMock({ data: invite, error: null }) },
        { table: 'vendor_users', response: createSupabaseMock({ data: existingUser, error: null }) },
      ]);

      await expect(
        service.register({ token: invite.token, password: 'password123' }),
      ).rejects.toMatchObject({
        name: 'ConflictError',
        statusCode: 409,
        message: 'Email already registered',
      });
    });

    it('returns SafeVendorUser and marks invite as used on success', async () => {
      const vendor = makeVendor();
      const invite = makeInvite({ vendor_id: vendor.id, email: 'new@test.com' });
      const newUser = makeVendorUser({
        id: 'new-user-id',
        vendor_id: vendor.id,
        email: 'new@test.com',
      });

      const insertedUserData = {
        id: newUser.id,
        vendor_id: newUser.vendor_id,
        email: newUser.email,
        created_at: newUser.created_at,
        updated_at: newUser.updated_at,
      };

      // vendor_invites (get invite), vendor_users (check existing), vendor_users (insert), vendor_invites (mark used)
      mockFromSequence([
        { table: 'vendor_invites', response: createSupabaseMock({ data: invite, error: null }) },
        { table: 'vendor_users', response: createSupabaseMock({ data: null, error: { message: 'No rows' } }) },
        { table: 'vendor_users', response: createSupabaseMock({ data: insertedUserData, error: null }) },
        { table: 'vendor_invites', response: createSupabaseMock({ data: null, error: null }) },
      ]);

      const result = await service.register({ token: invite.token, password: 'securepassword' });

      expect(result).toEqual({
        id: newUser.id,
        vendorId: vendor.id,
        email: 'new@test.com',
        createdAt: newUser.created_at,
        updatedAt: newUser.updated_at,
      });

      // Ensure password was hashed
      expect(bcrypt.hash).toHaveBeenCalledWith('securepassword', 10);
    });
  });

  // ── login ───────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('throws UnauthorizedError when user is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      await expect(
        service.login({ email: 'ghost@test.com', password: 'anypassword' }),
      ).rejects.toMatchObject({
        name: 'UnauthorizedError',
        statusCode: 401,
        message: 'Invalid email or password',
      });
    });

    it('throws UnauthorizedError when password is wrong', async () => {
      const user = makeVendorUser({ email: 'user@test.com' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      // Make bcrypt.compare return false for this test
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

      await expect(
        service.login({ email: 'user@test.com', password: 'wrongpassword' }),
      ).rejects.toMatchObject({
        name: 'UnauthorizedError',
        statusCode: 401,
        message: 'Invalid email or password',
      });
    });

    it('returns SafeVendorUser (without passwordHash) on successful login', async () => {
      const user = makeVendorUser({ email: 'user@test.com', vendor_id: 'vendor-abc' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      // bcrypt.compare is mocked to return true by default
      const result = await service.login({ email: 'user@test.com', password: 'correctpassword' });

      expect(result).toEqual({
        id: user.id,
        vendorId: user.vendor_id,
        email: user.email,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      });

      // Must not expose the password hash
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password_hash');
    });
  });

  // ── changePassword ──────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('throws NotFoundError when user does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Not found' } }),
      );

      await expect(
        service.changePassword('nonexistent-id', 'old', 'newpassword1'),
      ).rejects.toMatchObject({
        name: 'NotFoundError',
        statusCode: 404,
        message: 'User not found',
      });
    });

    it('throws UnauthorizedError when current password is wrong', async () => {
      const user = makeVendorUser({ id: 'user-id-1' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: { id: user.id, password_hash: user.password_hash }, error: null }),
      );

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

      await expect(
        service.changePassword(user.id, 'wrongcurrent', 'newpassword1'),
      ).rejects.toMatchObject({
        name: 'UnauthorizedError',
        statusCode: 401,
        message: 'Current password is incorrect',
      });
    });

    it('updates the password hash on success', async () => {
      const user = makeVendorUser({ id: 'user-id-2' });

      mockFromSequence([
        { table: 'vendor_users', response: createSupabaseMock({ data: { id: user.id, password_hash: user.password_hash }, error: null }) },
        { table: 'vendor_users', response: createSupabaseMock({ data: null, error: null }) },
      ]);

      // bcrypt.compare returns true (default mock), bcrypt.hash returns the mock hash
      await expect(
        service.changePassword(user.id, 'currentpassword', 'newpassword123'),
      ).resolves.toBeUndefined();

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 10);
    });
  });

  // ── createPasswordReset ─────────────────────────────────────────────────────

  describe('createPasswordReset', () => {
    it('returns empty token when email does not exist (prevents enumeration)', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const result = await service.createPasswordReset('ghost@test.com');

      expect(result).toEqual({ token: '' });
    });

    it('returns a reset token when email exists', async () => {
      const user = makeVendorUser({ email: 'existing@test.com' });

      mockFromSequence([
        // lookup user
        { table: 'vendor_users', response: createSupabaseMock({ data: { id: user.id }, error: null }) },
        // invalidate old tokens
        { table: 'vendor_password_resets', response: createSupabaseMock({ data: null, error: null }) },
        // insert new token
        { table: 'vendor_password_resets', response: createSupabaseMock({ data: null, error: null }) },
      ]);

      const result = await service.createPasswordReset('existing@test.com');

      expect(result.token).toBe('test-nanoid-32-chars-predictable!!');
      expect(result.token.length).toBeGreaterThan(0);
    });
  });

  // ── resetPassword ───────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('throws NotFoundError when token does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      await expect(
        service.resetPassword('bad-token', 'newpassword123'),
      ).rejects.toMatchObject({
        name: 'NotFoundError',
        statusCode: 404,
        message: 'Invalid or expired reset token',
      });
    });

    it('throws ValidationError when token has already been used', async () => {
      const resetRecord = {
        email: 'user@test.com',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        used_at: new Date().toISOString(),
      };

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: resetRecord, error: null }),
      );

      await expect(
        service.resetPassword('used-token', 'newpassword123'),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Reset token has already been used',
      });
    });

    it('throws ValidationError when token has expired', async () => {
      const resetRecord = {
        email: 'user@test.com',
        expires_at: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
        used_at: null,
      };

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: resetRecord, error: null }),
      );

      await expect(
        service.resetPassword('expired-token', 'newpassword123'),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Reset token has expired',
      });
    });

    it('updates password and marks token as used on success', async () => {
      const resetRecord = {
        email: 'user@test.com',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        used_at: null,
      };

      mockFromSequence([
        // fetch reset record
        { table: 'vendor_password_resets', response: createSupabaseMock({ data: resetRecord, error: null }) },
        // update user password
        { table: 'vendor_users', response: createSupabaseMock({ data: null, error: null }) },
        // mark token as used
        { table: 'vendor_password_resets', response: createSupabaseMock({ data: null, error: null }) },
      ]);

      await expect(
        service.resetPassword('valid-token', 'brandnewpassword'),
      ).resolves.toBeUndefined();

      expect(bcrypt.hash).toHaveBeenCalledWith('brandnewpassword', 10);
    });
  });

  // ── getUserById ─────────────────────────────────────────────────────────────

  describe('getUserById', () => {
    it('returns null when user is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const result = await service.getUserById('nonexistent-id');

      expect(result).toBeNull();
    });

    it('returns SafeVendorUser when user exists', async () => {
      const user = makeVendorUser({ id: 'found-user-id', vendor_id: 'vendor-xyz', email: 'found@test.com' });

      const dbRow = {
        id: user.id,
        vendor_id: user.vendor_id,
        email: user.email,
        created_at: user.created_at,
        updated_at: user.updated_at,
      };

      mockFromSequence([
        { table: 'vendor_users', response: createSupabaseMock({ data: dbRow, error: null }) },
        { table: 'vendor_user_roles', response: createSupabaseMock({ data: [{ vendor_id: 'vendor-xyz', role: 'owner', vendors: { name: 'Test Vendor', logo_url: null } }], error: null }) },
      ]);

      const result = await service.getUserById('found-user-id');

      expect(result).toEqual({
        id: user.id,
        vendorId: user.vendor_id,
        email: user.email,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        vendors: [{ vendorId: 'vendor-xyz', vendorName: 'Test Vendor', role: 'owner', logoUrl: null }],
      });

      // Must not include passwordHash
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password_hash');
    });
  });
});
