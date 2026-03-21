import { FastifyPluginAsync } from 'fastify';
import {
  adminLoginSchema,
  adminLogoutSchema,
  adminMeSchema,
  adminChangePasswordSchema,
} from './admin-auth.schema.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminLoginPayload, AdminJwtPayload } from './admin-auth.types.js';
import { authenticateAdmin } from '../lib/auth.js';
import { TooManyRequestsError } from '../lib/errors.js';
import redis from '../lib/redis.js';

const COOKIE_NAME = 'token';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours
const JWT_EXPIRY = '24h';

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

const adminAuthController: FastifyPluginAsync = async (fastify) => {
  const authService = new AdminAuthService();

  // POST /admin/auth/login
  fastify.post('/login', { schema: adminLoginSchema }, async (request, reply) => {
    const payload = request.body as AdminLoginPayload;

    const rateKey = `admin:login:${payload.email}`;
    const attempts = await redis.incr(rateKey);
    if (attempts === 1) {
      await redis.expire(rateKey, LOGIN_WINDOW_SECONDS);
    }
    if (attempts > LOGIN_MAX_ATTEMPTS) {
      throw new TooManyRequestsError('Too many login attempts, try again in 15 minutes');
    }

    const user = await authService.login(payload);

    await redis.del(rateKey);

    const jwtPayload: AdminJwtPayload = {
      userId: user.id,
      email: user.email,
      role: 'admin',
    };

    const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: JWT_EXPIRY });

    reply
      .setCookie(COOKIE_NAME, jwtToken, cookieOpts())
      .send({ user });
  });

  // POST /admin/auth/logout
  fastify.post('/logout', { schema: adminLogoutSchema }, async (request, reply) => {
    reply
      .clearCookie(COOKIE_NAME, { path: '/' })
      .send({ message: 'Logged out' });
  });

  // GET /admin/auth/me
  fastify.get('/me', {
    schema: adminMeSchema,
    preHandler: [authenticateAdmin],
  }, async (request, reply) => {
    const { userId } = request.user as AdminJwtPayload;
    const user = await authService.getUserById(userId);
    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    const jwtPayload: AdminJwtPayload = {
      userId: user.id,
      email: user.email,
      role: 'admin',
    };
    const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: JWT_EXPIRY });

    reply.setCookie(COOKIE_NAME, jwtToken, cookieOpts());

    return { user };
  });

  // POST /admin/auth/change-password
  fastify.post('/change-password', {
    schema: adminChangePasswordSchema,
    preHandler: [authenticateAdmin],
  }, async (request, reply) => {
    const { userId } = request.user as AdminJwtPayload;
    const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };
    await authService.changePassword(userId, currentPassword, newPassword);
    return { message: 'Password changed successfully' };
  });
};

export default adminAuthController;
