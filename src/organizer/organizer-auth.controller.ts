import { FastifyPluginAsync } from 'fastify';
import {
  organizerInviteSchema,
  organizerValidateInviteSchema,
  organizerRegisterSchema,
  organizerLoginSchema,
  organizerLogoutSchema,
  organizerMeSchema,
  organizerChangePasswordSchema,
  organizerAdminResetPasswordSchema,
  organizerForgotPasswordSchema,
  organizerResetPasswordSchema,
  organizerUpdateProfileSchema,
} from './organizer-auth.schema.js';
import { OrganizerAuthService } from './organizer-auth.service.js';
import {
  OrganizerLoginPayload,
  OrganizerRegisterPayload,
  OrganizerInvitePayload,
  OrganizerJwtPayload,
  OrganizerUpdateProfilePayload,
} from './organizer-auth.types.js';
import { authenticateOrganizer } from '../lib/auth.js';
import { UnauthorizedError, TooManyRequestsError } from '../lib/errors.js';
import redis from '../lib/redis.js';

const COOKIE_NAME = 'token';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours
const JWT_EXPIRY = '24h';

// Rate limiting: max 20 login attempts per email per 15 minutes
const LOGIN_MAX_ATTEMPTS = 20;
const LOGIN_WINDOW_SECONDS = 15 * 60;

function cookieOpts() {
  return {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: COOKIE_MAX_AGE,
  };
}

const organizerAuthController: FastifyPluginAsync = async (fastify) => {
  const authService = new OrganizerAuthService();

  // POST /organizer/auth/invite — Create invite (super-admin only)
  fastify.post('/invite', { schema: organizerInviteSchema }, async (request, reply) => {
    const adminKey = request.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.ORGANIZER_ADMIN_SECRET) {
      throw new UnauthorizedError('Unauthorized');
    }

    const payload = request.body as OrganizerInvitePayload;
    const result = await authService.createInvite(payload);
    return reply.status(201).send(result);
  });

  // GET /organizer/auth/invite/:token — Validate invite token
  fastify.get('/invite/:token', { schema: organizerValidateInviteSchema }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const result = await authService.validateInvite(token);
    return result;
  });

  // POST /organizer/auth/register — Register via invite token
  fastify.post('/register', { schema: organizerRegisterSchema }, async (request, reply) => {
    const payload = request.body as OrganizerRegisterPayload;
    const user = await authService.register(payload);

    const jwtPayload: OrganizerJwtPayload = {
      userId: user.id,
      email: user.email,
      role: 'organizer',
    };

    const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: JWT_EXPIRY });

    reply
      .setCookie(COOKIE_NAME, jwtToken, cookieOpts())
      .status(201)
      .send({ user });
  });

  // POST /organizer/auth/login — Login with email + password
  fastify.post('/login', { schema: organizerLoginSchema }, async (request, reply) => {
    const payload = request.body as OrganizerLoginPayload;

    // Rate limiting: per email address
    const rateKey = `organizer:login:${payload.email}`;
    const attempts = await redis.incr(rateKey);
    if (attempts === 1) {
      await redis.expire(rateKey, LOGIN_WINDOW_SECONDS);
    }
    if (attempts > LOGIN_MAX_ATTEMPTS) {
      throw new TooManyRequestsError('Too many login attempts, try again in 15 minutes');
    }

    const user = await authService.login(payload);

    // Clear rate limit on successful login
    await redis.del(rateKey);

    const jwtPayload: OrganizerJwtPayload = {
      userId: user.id,
      email: user.email,
      role: 'organizer',
    };

    const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: JWT_EXPIRY });

    reply
      .setCookie(COOKIE_NAME, jwtToken, cookieOpts())
      .send({ user });
  });

  // POST /organizer/auth/logout — Clear cookie
  fastify.post('/logout', { schema: organizerLogoutSchema }, async (request, reply) => {
    reply
      .clearCookie(COOKIE_NAME, { path: '/' })
      .send({ message: 'Logged out' });
  });

  // POST /organizer/auth/forgot-password — Request a reset token
  fastify.post('/forgot-password', { schema: organizerForgotPasswordSchema }, async (request, reply) => {
    const { email } = request.body as { email: string };
    const { token } = await authService.createPasswordReset(email);

    if (token) {
      const resetUrl = `${process.env.ORGANIZER_APP_URL || 'http://localhost:3003'}/auth/reset-password?token=${token}`;
      // TODO: replace with email provider (Resend, SendGrid, etc.)
      fastify.log.info({ resetUrl }, 'Password reset link generated');
    }

    // Always return the same message to prevent email enumeration
    return { message: 'If that email exists, a reset link has been sent' };
  });

  // POST /organizer/auth/reset-password — Set new password via token
  fastify.post('/reset-password', { schema: organizerResetPasswordSchema }, async (request, reply) => {
    const { token, newPassword } = request.body as { token: string; newPassword: string };
    await authService.resetPassword(token, newPassword);
    return { message: 'Password reset successfully' };
  });

  // POST /organizer/auth/change-password — Self-service (requires current password)
  fastify.post('/change-password', {
    schema: organizerChangePasswordSchema,
    preHandler: [authenticateOrganizer],
  }, async (request, reply) => {
    const { userId } = request.user as OrganizerJwtPayload;
    const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };
    await authService.changePassword(userId, currentPassword, newPassword);
    return { message: 'Password changed successfully' };
  });

  // POST /organizer/auth/admin-reset-password — Admin-initiated reset (X-Admin-Key required)
  fastify.post('/admin-reset-password', {
    schema: organizerAdminResetPasswordSchema,
  }, async (request, reply) => {
    const adminKey = request.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.ORGANIZER_ADMIN_SECRET) {
      throw new UnauthorizedError('Unauthorized');
    }
    const { email, newPassword } = request.body as { email: string; newPassword: string };
    await authService.adminResetPassword(email, newPassword);
    return { message: 'Password reset successfully' };
  });

  // PATCH /organizer/auth/profile — Update organizer profile
  fastify.patch('/profile', {
    schema: organizerUpdateProfileSchema,
    preHandler: [authenticateOrganizer],
  }, async (request, reply) => {
    const { userId } = request.user as OrganizerJwtPayload;
    const payload = request.body as OrganizerUpdateProfilePayload;
    const user = await authService.updateProfile(userId, payload);
    return { user };
  });

  // GET /organizer/auth/me — Get current organizer + renew session (sliding expiry)
  fastify.get('/me', {
    schema: organizerMeSchema,
    preHandler: [authenticateOrganizer],
  }, async (request, reply) => {
    const { userId } = request.user as OrganizerJwtPayload;
    const user = await authService.getUserById(userId);
    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    // Reissue JWT on every /me call — active sessions never expire
    const jwtPayload: OrganizerJwtPayload = {
      userId: user.id,
      email: user.email,
      role: 'organizer',
    };
    const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: JWT_EXPIRY });

    reply.setCookie(COOKIE_NAME, jwtToken, cookieOpts());

    return { user };
  });
};

export default organizerAuthController;
