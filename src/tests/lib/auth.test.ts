import { describe, it, expect, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp, generateToken } from '../helpers/app.js';
import { authenticate, authenticateOrganizer } from '../../lib/auth.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Auth Middleware', () => {
  let app: FastifyInstance;

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── authenticate ──────────────────────────────────────────────────────────

  describe('authenticate', () => {
    it('should allow request with a valid JWT token', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/protected', { preHandler: [authenticate] }, async (req) => {
          return { ok: true, user: req.user };
        });
      });

      const token = generateToken(app, {
        userId: 'user-1',
        email: 'test@test.com',
        role: 'vendor',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.user.userId).toBe('user-1');
      expect(body.user.email).toBe('test@test.com');
    });

    it('should reject request with no authorization header', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/protected', { preHandler: [authenticate] }, async () => {
          return { ok: true };
        });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Authentication required');
    });

    it('should reject request with an invalid JWT token', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/protected', { preHandler: [authenticate] }, async () => {
          return { ok: true };
        });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: 'Bearer invalid.token.here' },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Authentication required');
    });

    it('should reject request with an expired JWT token', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/protected', { preHandler: [authenticate] }, async () => {
          return { ok: true };
        });
      });

      // Sign a token with exp set to 1 second in the past
      const expiredToken = app.jwt.sign(
        {
          userId: 'user-1',
          email: 'test@test.com',
          role: 'vendor',
        } as any,
        { expiresIn: -10 },
      );

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${expiredToken}` },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Authentication required');
    });

    it('should reject request with a malformed authorization header', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/protected', { preHandler: [authenticate] }, async () => {
          return { ok: true };
        });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: 'NotBearer some-token' },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Authentication required');
    });

    it('should allow both vendor and organizer roles', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/protected', { preHandler: [authenticate] }, async (req) => {
          return { role: (req.user as any).role };
        });
      });

      const vendorToken = generateToken(app, {
        userId: 'user-1',
        email: 'vendor@test.com',
        role: 'vendor',
      });

      const organizerToken = generateToken(app, {
        userId: 'user-2',
        email: 'organizer@test.com',
        role: 'organizer',
      });

      const vendorResp = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${vendorToken}` },
      });

      const organizerResp = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${organizerToken}` },
      });

      expect(vendorResp.statusCode).toBe(200);
      expect(JSON.parse(vendorResp.body).role).toBe('vendor');

      expect(organizerResp.statusCode).toBe(200);
      expect(JSON.parse(organizerResp.body).role).toBe('organizer');
    });
  });

  // ── authenticateOrganizer ─────────────────────────────────────────────────

  describe('authenticateOrganizer', () => {
    it('should allow request with a valid organizer JWT token', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/organizer-only', { preHandler: [authenticateOrganizer] }, async (req) => {
          return { ok: true, user: req.user };
        });
      });

      const token = generateToken(app, {
        userId: 'org-1',
        email: 'organizer@test.com',
        role: 'organizer',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/organizer-only',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.user.role).toBe('organizer');
    });

    it('should reject request with a vendor role token', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/organizer-only', { preHandler: [authenticateOrganizer] }, async () => {
          return { ok: true };
        });
      });

      const vendorToken = generateToken(app, {
        userId: 'user-1',
        email: 'vendor@test.com',
        role: 'vendor',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/organizer-only',
        headers: { authorization: `Bearer ${vendorToken}` },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Access denied');
    });

    it('should reject request with no authorization header', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/organizer-only', { preHandler: [authenticateOrganizer] }, async () => {
          return { ok: true };
        });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/organizer-only',
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Authentication required');
    });

    it('should reject request with an invalid JWT token', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/organizer-only', { preHandler: [authenticateOrganizer] }, async () => {
          return { ok: true };
        });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/organizer-only',
        headers: { authorization: 'Bearer garbage.token.data' },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Authentication required');
    });

    it('should reject token with no role claim', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/organizer-only', { preHandler: [authenticateOrganizer] }, async () => {
          return { ok: true };
        });
      });

      // Sign a token without a role field
      const noRoleToken = app.jwt.sign({ userId: 'user-1', email: 'test@test.com' });

      const response = await app.inject({
        method: 'GET',
        url: '/organizer-only',
        headers: { authorization: `Bearer ${noRoleToken}` },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Access denied');
    });

    it('should reject token with an unrecognized role', async () => {
      app = await buildApp(async (instance) => {
        instance.get('/organizer-only', { preHandler: [authenticateOrganizer] }, async () => {
          return { ok: true };
        });
      });

      const badRoleToken = app.jwt.sign({
        userId: 'user-1',
        email: 'test@test.com',
        role: 'admin',
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: '/organizer-only',
        headers: { authorization: `Bearer ${badRoleToken}` },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Access denied');
    });
  });
});
