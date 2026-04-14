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
import { authenticate, authenticateAdmin } from '../lib/auth.js';
import { sendEmail } from '../lib/email.js';
import * as staffService from '../staff/staff.service.js';
import { AppError } from '../lib/errors.js';

const COOKIE_NAME = 'token';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

const authController: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService();

  // POST /auth/invite — Create invite for a vendor (admin only)
  fastify.post('/invite', { schema: inviteSchema, preHandler: [authenticateAdmin] }, async (request, reply) => {
    const payload = request.body as InvitePayload;
    const result = await authService.createInvite(payload);

    const signupUrl = `${process.env.VENDOR_APP_URL || 'http://localhost:3001'}/auth/register?token=${result.inviteToken}`;
    void sendEmail({
      to: payload.email,
      subject: 'You\'ve been invited to join NowNow',
      html: `
        <h2>You've been invited!</h2>
        <p>You've been invited to manage a vendor on NowNow.</p>
        <p><a href="${signupUrl}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">Accept Invite & Sign Up</a></p>
        <p>This link expires in 7 days.</p>
        <p style="color:#666;font-size:12px;">If you didn't expect this, ignore this email.</p>
      `,
    }).catch(err => fastify.log.error(err, 'Failed to send vendor invite email'));

    return reply.status(201).send(result);
  });

  // GET /auth/invite/:token — Validate invite token
  fastify.get('/invite/:token', { schema: validateInviteSchema }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const result = await authService.validateInvite(token);
    return result;
  });

  // POST /auth/register — Register via invite token
  fastify.post('/register', { schema: registerSchema, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const payload = request.body as RegisterPayload;
    const user = await authService.register(payload);

    const jwtPayload: JwtPayload = {
      userId: user.id,
      vendorId: user.vendorId,
      email: user.email,
      role: 'vendor',
    };

    const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: '90d' });

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
  fastify.post('/login', { schema: loginSchema, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const payload = request.body as LoginPayload;
    const user = await authService.login(payload);

    const jwtPayload: JwtPayload = {
      userId: user.id,
      vendorId: user.vendorId,
      email: user.email,
      role: 'vendor',
    };

    const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: '90d' });

    reply
      .setCookie(COOKIE_NAME, jwtToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: COOKIE_MAX_AGE,
      })
      .send({ user, token: jwtToken });
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
  fastify.post('/forgot-password', { schema: forgotPasswordSchema, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email } = request.body as { email: string };
    const { token } = await authService.createPasswordReset(email);

    if (token) {
      const resetUrl = `${process.env.VENDOR_APP_URL || 'http://localhost:3001'}/auth/reset-password?token=${token}`;
      void sendEmail({
        to: email,
        subject: 'Reset your NowNow password',
        html: `
          <h2>Password Reset</h2>
          <p>We received a request to reset your password.</p>
          <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p>
          <p>This link expires in 1 hour.</p>
          <p style="color:#666;font-size:12px;">If you didn't request this, ignore this email.</p>
        `,
      }).catch(err => fastify.log.error(err, 'Failed to send vendor password reset email'));
    }

    // Always return the same message to prevent email enumeration
    return { message: 'If that email exists, a reset link has been sent' };
  });

  // POST /auth/reset-password — Set new password via token
  fastify.post('/reset-password', { schema: resetPasswordSchema, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { token, newPassword } = request.body as { token: string; newPassword: string };
    await authService.resetPassword(token, newPassword);
    return { message: 'Password reset successfully' };
  });

  // GET /auth/me — Get current user (protected), returns refreshed token
  fastify.get('/me', {
    schema: meSchema,
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { userId } = request.user as JwtPayload;
    const user = await authService.getUserById(userId);
    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    // Issue a fresh token on every /me call so the session stays alive
    const jwtPayload: JwtPayload = {
      userId: user.id,
      vendorId: user.vendorId,
      email: user.email,
      role: 'vendor',
    };
    const token = fastify.jwt.sign(jwtPayload, { expiresIn: '90d' });

    return { user, token };
  });

  // GET /auth/invite/staff/:token — validate staff invite (public)
  fastify.get<{ Params: { token: string } }>(
    '/invite/staff/:token',
    async (request) => {
      const invite = await staffService.validateStaffInvite(request.params.token);
      return { invite };
    }
  );

  // POST /auth/register/staff — register via staff invite
  fastify.post<{ Body: { token: string; email: string; password: string } }>(
    '/register/staff',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const invite = await staffService.validateStaffInvite(request.body.token);
      if (invite.email !== request.body.email) {
        throw new AppError('Email does not match invite', 400);
      }

      const user = await authService.registerWithInvite({
        email: request.body.email,
        password: request.body.password,
        vendorId: invite.vendorId,
      });

      await staffService.acceptStaffInvite(request.body.token, user.id);

      const jwtPayload: JwtPayload = {
        userId: user.id,
        vendorId: invite.vendorId,
        email: user.email,
        role: 'vendor',
      };

      const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: '90d' });

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
    }
  );
};

export default authController;
