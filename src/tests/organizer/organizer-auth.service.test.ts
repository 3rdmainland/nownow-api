import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';
import { makeOrganizerUser } from '../fixtures/index.js';

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

// Import after mocks are set up
import { OrganizerAuthService } from '../../organizer/organizer-auth.service.js';
import bcrypt from 'bcryptjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFromSequence(responses: Array<{ table: string; response: ReturnType<typeof createSupabaseMock> }>) {
  let callIndex = 0;
  supabaseMock.from.mockImplementation((table: string) => {
    const entry = responses[callIndex];
    callIndex++;
    return entry?.response ?? createSupabaseMock({ data: null, error: null });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OrganizerAuthService', () => {
  let service: OrganizerAuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrganizerAuthService();
  });

  // ── createInvite ────────────────────────────────────────────────────────────

  describe('createInvite', () => {
    it('throws ConflictError when organizer with email already exists', async () => {
      const existingUser = makeOrganizerUser({ email: 'taken@test.com' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: existingUser, error: null }),
      );

      await expect(
        service.createInvite({ email: 'taken@test.com' }),
      ).rejects.toMatchObject({
        name: 'ConflictError',
        statusCode: 409,
        message: 'An organizer with this email already exists',
      });
    });

    it('returns inviteToken and expiresAt on success', async () => {
      mockFromSequence([
        // no existing user
        { table: 'organizer_users', response: createSupabaseMock({ data: null, error: { message: 'No rows' } }) },
        // insert invite
        { table: 'organizer_invites', response: createSupabaseMock({ data: null, error: null }) },
      ]);

      const result = await service.createInvite({ email: 'newinvite@test.com' });

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

    it('throws when the invite insert fails', async () => {
      mockFromSequence([
        { table: 'organizer_users', response: createSupabaseMock({ data: null, error: { message: 'No rows' } }) },
        { table: 'organizer_invites', response: createSupabaseMock({ data: null, error: { message: 'insert failed' } }) },
      ]);

      await expect(
        service.createInvite({ email: 'new@test.com' }),
      ).rejects.toThrow('Failed to create invite: insert failed');
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
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({
          data: { email: 'user@test.com', expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: new Date().toISOString() },
          error: null,
        }),
      );

      await expect(service.validateInvite('used-token')).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invite has already been used',
      });
    });

    it('throws ValidationError when invite has expired', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({
          data: { email: 'user@test.com', expires_at: new Date(Date.now() - 1000).toISOString(), used_at: null },
          error: null,
        }),
      );

      await expect(service.validateInvite('expired-token')).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invite has expired',
      });
    });

    it('returns email on success', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({
          data: { email: 'valid@test.com', expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), used_at: null },
          error: null,
        }),
      );

      const result = await service.validateInvite('valid-token');

      expect(result).toEqual({ email: 'valid@test.com' });
    });
  });

  // ── register ────────────────────────────────────────────────────────────────

  describe('register', () => {
    it('throws ValidationError when invite token is invalid', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      await expect(
        service.register({ token: 'invalid-token', password: 'password123', name: 'Test' }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invalid invite token',
      });
    });

    it('throws ValidationError when invite has already been used', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({
          data: {
            email: 'used@test.com',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            used_at: new Date().toISOString(),
          },
          error: null,
        }),
      );

      await expect(
        service.register({ token: 'used-token', password: 'password123', name: 'Test' }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invite has already been used',
      });
    });

    it('throws ValidationError when invite has expired', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({
          data: {
            email: 'expired@test.com',
            expires_at: new Date(Date.now() - 60_000).toISOString(),
            used_at: null,
          },
          error: null,
        }),
      );

      await expect(
        service.register({ token: 'expired-token', password: 'password123', name: 'Test' }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invite has expired',
      });
    });

    it('throws ConflictError when email is already registered', async () => {
      const invite = {
        email: 'already@test.com',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        used_at: null,
      };
      const existingUser = makeOrganizerUser({ email: 'already@test.com' });

      mockFromSequence([
        { table: 'organizer_invites', response: createSupabaseMock({ data: invite, error: null }) },
        { table: 'organizer_users', response: createSupabaseMock({ data: existingUser, error: null }) },
      ]);

      await expect(
        service.register({ token: 'valid-token', password: 'password123', name: 'Test' }),
      ).rejects.toMatchObject({
        name: 'ConflictError',
        statusCode: 409,
        message: 'Email already registered',
      });
    });

    it('returns SafeOrganizerUser and marks invite as used on success', async () => {
      const invite = {
        email: 'new@test.com',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        used_at: null,
      };

      const newUser = {
        id: 'new-organizer-id',
        email: 'new@test.com',
        name: 'Test Organizer',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockFromSequence([
        { table: 'organizer_invites', response: createSupabaseMock({ data: invite, error: null }) },
        { table: 'organizer_users', response: createSupabaseMock({ data: null, error: { message: 'No rows' } }) },
        { table: 'organizer_users', response: createSupabaseMock({ data: newUser, error: null }) },
        { table: 'organizer_invites', response: createSupabaseMock({ data: null, error: null }) },
      ]);

      const result = await service.register({ token: 'valid-token', password: 'securepassword', name: 'Test Organizer' });

      expect(result).toEqual({
        id: 'new-organizer-id',
        email: 'new@test.com',
        name: 'Test Organizer',
        createdAt: newUser.created_at,
        updatedAt: newUser.updated_at,
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('securepassword', 10);
    });

    it('throws when the user insert fails', async () => {
      const invite = {
        email: 'new@test.com',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        used_at: null,
      };

      mockFromSequence([
        { table: 'organizer_invites', response: createSupabaseMock({ data: invite, error: null }) },
        { table: 'organizer_users', response: createSupabaseMock({ data: null, error: { message: 'No rows' } }) },
        { table: 'organizer_users', response: createSupabaseMock({ data: null, error: { message: 'insert failed' } }) },
      ]);

      await expect(
        service.register({ token: 'valid-token', password: 'securepassword', name: 'Test' }),
      ).rejects.toThrow('Registration failed: insert failed');
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
      const user = makeOrganizerUser({ email: 'user@test.com' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

      await expect(
        service.login({ email: 'user@test.com', password: 'wrongpassword' }),
      ).rejects.toMatchObject({
        name: 'UnauthorizedError',
        statusCode: 401,
        message: 'Invalid email or password',
      });
    });

    it('returns SafeOrganizerUser on successful login', async () => {
      const user = makeOrganizerUser({ email: 'user@test.com', name: 'My Organizer' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: user, error: null }),
      );

      const result = await service.login({ email: 'user@test.com', password: 'correctpassword' });

      expect(result).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      });

      // Must not expose the password hash
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password_hash');
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

    it('returns SafeOrganizerUser when user exists', async () => {
      const user = makeOrganizerUser({ id: 'found-id', email: 'found@test.com', name: 'Found' });

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

      const result = await service.getUserById('found-id');

      expect(result).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      });

      expect(result).not.toHaveProperty('password_hash');
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
      const user = makeOrganizerUser({ email: 'existing@test.com' });

      mockFromSequence([
        { table: 'organizer_users', response: createSupabaseMock({ data: { id: user.id }, error: null }) },
        { table: 'organizer_password_resets', response: createSupabaseMock({ data: null, error: null }) },
        { table: 'organizer_password_resets', response: createSupabaseMock({ data: null, error: null }) },
      ]);

      const result = await service.createPasswordReset('existing@test.com');

      expect(result.token).toBe('test-nanoid-32-chars-predictable!!');
      expect(result.token.length).toBeGreaterThan(0);
    });

    it('throws when the reset token insert fails', async () => {
      const user = makeOrganizerUser({ email: 'existing@test.com' });

      mockFromSequence([
        { table: 'organizer_users', response: createSupabaseMock({ data: { id: user.id }, error: null }) },
        { table: 'organizer_password_resets', response: createSupabaseMock({ data: null, error: null }) },
        { table: 'organizer_password_resets', response: createSupabaseMock({ data: null, error: { message: 'insert failed' } }) },
      ]);

      await expect(
        service.createPasswordReset('existing@test.com'),
      ).rejects.toThrow('Failed to create reset token: insert failed');
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
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({
          data: {
            email: 'user@test.com',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            used_at: new Date().toISOString(),
          },
          error: null,
        }),
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
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({
          data: {
            email: 'user@test.com',
            expires_at: new Date(Date.now() - 60_000).toISOString(),
            used_at: null,
          },
          error: null,
        }),
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
      mockFromSequence([
        {
          table: 'organizer_password_resets',
          response: createSupabaseMock({
            data: {
              email: 'user@test.com',
              expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              used_at: null,
            },
            error: null,
          }),
        },
        { table: 'organizer_users', response: createSupabaseMock({ data: null, error: null }) },
        { table: 'organizer_password_resets', response: createSupabaseMock({ data: null, error: null }) },
      ]);

      await expect(
        service.resetPassword('valid-token', 'brandnewpassword'),
      ).resolves.toBeUndefined();

      expect(bcrypt.hash).toHaveBeenCalledWith('brandnewpassword', 10);
    });

    it('throws when the password update fails', async () => {
      mockFromSequence([
        {
          table: 'organizer_password_resets',
          response: createSupabaseMock({
            data: {
              email: 'user@test.com',
              expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              used_at: null,
            },
            error: null,
          }),
        },
        { table: 'organizer_users', response: createSupabaseMock({ data: null, error: { message: 'update failed' } }) },
      ]);

      await expect(
        service.resetPassword('valid-token', 'newpassword'),
      ).rejects.toThrow('Failed to reset password: update failed');
    });
  });

  // ── adminResetPassword ─────────────────────────────────────────────────────

  describe('adminResetPassword', () => {
    it('throws NotFoundError when organizer is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      await expect(
        service.adminResetPassword('nonexistent@test.com', 'newpassword'),
      ).rejects.toMatchObject({
        name: 'NotFoundError',
        statusCode: 404,
        message: 'Organizer not found',
      });
    });

    it('updates the password hash on success', async () => {
      const user = makeOrganizerUser({ id: 'org-id-1' });

      mockFromSequence([
        { table: 'organizer_users', response: createSupabaseMock({ data: { id: user.id }, error: null }) },
        { table: 'organizer_users', response: createSupabaseMock({ data: null, error: null }) },
      ]);

      await expect(
        service.adminResetPassword('organizer@test.com', 'admin-new-password'),
      ).resolves.toBeUndefined();

      expect(bcrypt.hash).toHaveBeenCalledWith('admin-new-password', 10);
    });

    it('throws when the password update fails', async () => {
      const user = makeOrganizerUser({ id: 'org-id-1' });

      mockFromSequence([
        { table: 'organizer_users', response: createSupabaseMock({ data: { id: user.id }, error: null }) },
        { table: 'organizer_users', response: createSupabaseMock({ data: null, error: { message: 'update error' } }) },
      ]);

      await expect(
        service.adminResetPassword('organizer@test.com', 'newpassword'),
      ).rejects.toThrow('Failed to reset password: update error');
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
      const user = makeOrganizerUser({ id: 'user-id-1' });

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
      const user = makeOrganizerUser({ id: 'user-id-2' });

      mockFromSequence([
        { table: 'organizer_users', response: createSupabaseMock({ data: { id: user.id, password_hash: user.password_hash }, error: null }) },
        { table: 'organizer_users', response: createSupabaseMock({ data: null, error: null }) },
      ]);

      await expect(
        service.changePassword(user.id, 'currentpassword', 'newpassword123'),
      ).resolves.toBeUndefined();

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 10);
    });

    it('throws when the password update fails', async () => {
      const user = makeOrganizerUser({ id: 'user-id-3' });

      mockFromSequence([
        { table: 'organizer_users', response: createSupabaseMock({ data: { id: user.id, password_hash: user.password_hash }, error: null }) },
        { table: 'organizer_users', response: createSupabaseMock({ data: null, error: { message: 'DB error' } }) },
      ]);

      await expect(
        service.changePassword(user.id, 'currentpassword', 'newpassword'),
      ).rejects.toThrow('Failed to update password: DB error');
    });
  });
});
