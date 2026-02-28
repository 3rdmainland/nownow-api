import { FastifyPluginAsync } from 'fastify';
import {
  inviteSchema,
  validateInviteSchema,
  registerSchema,
  loginSchema,
  meSchema,
  logoutSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schema.js';
import { AuthService } from './auth.service.js';
import { RegisterPayload, LoginPayload, InvitePayload, JwtPayload } from './auth.types.js';
import { authenticate } from '../lib/auth.js';

const COOKIE_NAME = 'token';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

const authController: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService();

  // POST /auth/invite — Create invite for a vendor
  fastify.post('/invite', { schema: inviteSchema }, async (request, reply) => {
    const payload = request.body as InvitePayload;
    const result = await authService.createInvite(payload);
    return reply.status(201).send(result);
  });

  // GET /auth/invite/:token — Validate invite token
  fastify.get('/invite/:token', { schema: validateInviteSchema }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const result = await authService.validateInvite(token);
    return result;
  });

  // POST /auth/register — Register via invite token
  fastify.post('/register', { schema: registerSchema }, async (request, reply) => {
    const payload = request.body as RegisterPayload;
    const user = await authService.register(payload);

    const jwtPayload: JwtPayload = {
      userId: user.id,
      vendorId: user.vendorId,
      email: user.email,
      role: 'vendor',
    };

    const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: '24h' });

    reply
      .setCookie(COOKIE_NAME, jwtToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: COOKIE_MAX_AGE,
      })
      .status(201)
      .send({ user });
  });

  // POST /auth/login — Login with email + password
  fastify.post('/login', { schema: loginSchema }, async (request, reply) => {
    const payload = request.body as LoginPayload;
    const user = await authService.login(payload);

    const jwtPayload: JwtPayload = {
      userId: user.id,
      vendorId: user.vendorId,
      email: user.email,
      role: 'vendor',
    };

    const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: '24h' });

    reply
      .setCookie(COOKIE_NAME, jwtToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: COOKIE_MAX_AGE,
      })
      .send({ user });
  });

  // POST /auth/logout — Clear cookie
  fastify.post('/logout', { schema: logoutSchema }, async (request, reply) => {
    reply
      .clearCookie(COOKIE_NAME, { path: '/' })
      .send({ message: 'Logged out' });
  });

  // POST /auth/change-password — Change password (protected)
  fastify.post('/change-password', {
    schema: changePasswordSchema,
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { userId } = request.user as JwtPayload;
    const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };
    await authService.changePassword(userId, currentPassword, newPassword);
    return { message: 'Password changed successfully' };
  });

  // POST /auth/forgot-password — Request a reset token
  fastify.post('/forgot-password', { schema: forgotPasswordSchema }, async (request, reply) => {
    const { email } = request.body as { email: string };
    const { token } = await authService.createPasswordReset(email);

    if (token) {
      const resetUrl = `${process.env.VENDOR_APP_URL || 'http://localhost:3001'}/auth/reset-password?token=${token}`;
      // TODO: replace with email provider (Resend, SendGrid, etc.)
      fastify.log.info({ resetUrl }, 'Vendor password reset link generated');
    }

    // Always return the same message to prevent email enumeration
    return { message: 'If that email exists, a reset link has been sent' };
  });

  // POST /auth/reset-password — Set new password via token
  fastify.post('/reset-password', { schema: resetPasswordSchema }, async (request, reply) => {
    const { token, newPassword } = request.body as { token: string; newPassword: string };
    await authService.resetPassword(token, newPassword);
    return { message: 'Password reset successfully' };
  });

  // GET /auth/me — Get current user (protected)
  fastify.get('/me', {
    schema: meSchema,
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { userId } = request.user as JwtPayload;
    const user = await authService.getUserById(userId);
    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }
    return { user };
  });
};

export default authController;
