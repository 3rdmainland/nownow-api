import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';
import { buildApp } from '../helpers/app.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));

vi.mock('../../lib/redis.js', () => ({
  default: redisMock,
  redis: redisMock,
  cache: cacheMock,
  CACHE_TTL: CACHE_TTL_MOCK,
}));

import customerAuthController from '../../customer-auth/customer-auth.controller.js';
import { FastifyInstance } from 'fastify';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function generateCustomerToken(app: FastifyInstance, payload: {
  customerId: string;
  phone: string;
}): string {
  return app.jwt.sign({ ...payload, role: 'customer' }, { expiresIn: '1h' });
}

const makeCustomer = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  phone: '27821234567',
  name: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  last_login_at: null,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Customer Auth Controller — Integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Default redis mocks for OTP
    redisMock.exists.mockResolvedValue(0);
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue('OK');
    redisMock.expire.mockResolvedValue(1);
    redisMock.incr.mockResolvedValue(1);
    redisMock.del.mockResolvedValue(1);

    app = await buildApp(async (a) => {
      await a.register(customerAuthController, { prefix: '/customer/auth' });
    });
  });

  // ── POST /customer/auth/request-otp ───────────────────────────────────────

  describe('POST /customer/auth/request-otp', () => {
    it('returns 200 with message and otp in non-production', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/customer/auth/request-otp',
        payload: { phone: '27821234567' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.message).toBe('Verification code sent');
      // In test env (non-production), OTP should be exposed
      expect(body.otp).toMatch(/^\d{6}$/);
    });

    it('returns 429 when cooldown is active', async () => {
      redisMock.exists.mockResolvedValueOnce(1); // cooldown active

      const res = await app.inject({
        method: 'POST',
        url: '/customer/auth/request-otp',
        payload: { phone: '27821234567' },
      });

      expect(res.statusCode).toBe(429);
      expect(res.json()).toMatchObject({ error: 'Please wait before requesting another code' });
    });

    it('returns 429 when hourly rate limit exceeded', async () => {
      redisMock.exists.mockResolvedValueOnce(0); // no cooldown
      redisMock.get.mockResolvedValueOnce(5); // max hourly

      const res = await app.inject({
        method: 'POST',
        url: '/customer/auth/request-otp',
        payload: { phone: '27821234567' },
      });

      expect(res.statusCode).toBe(429);
    });

    it('returns 400 when phone is too short', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/customer/auth/request-otp',
        payload: { phone: '12345' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /customer/auth/verify-otp ────────────────────────────────────────

  describe('POST /customer/auth/verify-otp', () => {
    it('returns 200, sets JWT cookie, and returns customer on success', async () => {
      // Mock Redis to have valid OTP
      const otpData = JSON.stringify({ code: '123456', attempts: 0 });
      redisMock.get.mockResolvedValueOnce(otpData);

      // Mock Supabase for findOrCreateByPhone
      const customer = makeCustomer({ phone: '27821234567' });
      mockFromSequence([
        createSupabaseMock({ data: customer, error: null }), // find customer
        createSupabaseMock({ data: null, error: null }),      // update last_login_at
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/customer/auth/verify-otp',
        payload: { phone: '27821234567', code: '123456' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.customer).toMatchObject({
        id: customer.id,
        phone: '27821234567',
      });

      // Should set JWT cookie
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieHeader).toMatch(/token=/);
      expect(cookieHeader).toMatch(/HttpOnly/i);
    });

    it('creates a new customer if phone does not exist', async () => {
      const otpData = JSON.stringify({ code: '654321', attempts: 0 });
      redisMock.get.mockResolvedValueOnce(otpData);

      const newCustomer = makeCustomer({ phone: '27829999999' });
      mockFromSequence([
        createSupabaseMock({ data: null, error: { message: 'No rows' } }), // find (not found)
        createSupabaseMock({ data: newCustomer, error: null }),             // insert
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/customer/auth/verify-otp',
        payload: { phone: '27829999999', code: '654321' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().customer.id).toBe(newCustomer.id);
    });

    it('returns 401 for wrong OTP code', async () => {
      const otpData = JSON.stringify({ code: '123456', attempts: 0 });
      redisMock.get.mockResolvedValueOnce(otpData);

      const res = await app.inject({
        method: 'POST',
        url: '/customer/auth/verify-otp',
        payload: { phone: '27821234567', code: '000000' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Invalid or expired code' });
    });

    it('returns 401 for expired OTP (not in Redis)', async () => {
      redisMock.get.mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: '/customer/auth/verify-otp',
        payload: { phone: '27821234567', code: '123456' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Invalid or expired code' });
    });

    it('returns 400 when code is not 6 digits', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/customer/auth/verify-otp',
        payload: { phone: '27821234567', code: '123' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /customer/auth/me ─────────────────────────────────────────────────

  describe('GET /customer/auth/me', () => {
    it('returns 200 with customer and renews session cookie', async () => {
      const customer = makeCustomer();
      const token = generateCustomerToken(app, {
        customerId: customer.id,
        phone: customer.phone,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: customer, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/customer/auth/me',
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().customer).toMatchObject({
        id: customer.id,
        phone: customer.phone,
      });

      // Session should be renewed
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
    });

    it('returns 401 when no cookie is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/customer/auth/me',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when JWT has wrong role', async () => {
      // Sign with vendor role
      const token = app.jwt.sign({
        userId: 'vendor-user',
        vendorId: 'vendor-id',
        email: 'vendor@test.com',
        role: 'vendor',
      }, { expiresIn: '1h' });

      const res = await app.inject({
        method: 'GET',
        url: '/customer/auth/me',
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Access denied' });
    });

    it('returns 401 when customer not found in DB', async () => {
      const token = generateCustomerToken(app, {
        customerId: 'deleted-customer-id',
        phone: '27821234567',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/customer/auth/me',
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Customer not found' });
    });
  });

  // ── POST /customer/auth/logout ────────────────────────────────────────────

  describe('POST /customer/auth/logout', () => {
    it('returns 200 and clears the token cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/customer/auth/logout',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ message: 'Logged out' });

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieHeader).toMatch(/token=/);
      expect(cookieHeader).toMatch(/Max-Age=0|token=;/i);
    });
  });

  // ── PATCH /customer/auth/profile ──────────────────────────────────────────

  describe('PATCH /customer/auth/profile', () => {
    it('returns 200 with updated customer', async () => {
      const customer = makeCustomer({ name: 'Old Name' });
      const token = generateCustomerToken(app, {
        customerId: customer.id,
        phone: customer.phone,
      });

      const updated = { ...customer, name: 'New Name' };
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: updated, error: null }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/customer/auth/profile',
        headers: { cookie: `token=${token}` },
        payload: { name: 'New Name' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().customer.name).toBe('New Name');
    });

    it('returns 401 when not authenticated', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/customer/auth/profile',
        payload: { name: 'Test' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when name is empty', async () => {
      const customer = makeCustomer();
      const token = generateCustomerToken(app, {
        customerId: customer.id,
        phone: customer.phone,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/customer/auth/profile',
        headers: { cookie: `token=${token}` },
        payload: { name: '' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
