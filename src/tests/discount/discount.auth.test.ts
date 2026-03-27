import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { cacheMock } from '../mocks/redis.js';
import { makeDiscount } from '../fixtures/index.js';
import { buildApp, generateToken } from '../helpers/app.js';

// ── Module mocks (must be at top level) ──────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock }));

vi.mock('../../lib/redis.js', () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
  },
  cache: cacheMock,
  CACHE_TTL: {
    VENDOR_LIST: 3600,
    VENDOR_DETAILS: 60,
    MENU_ITEMS: 300,
  },
}));

// NOTE: We do NOT mock auth.js here — we want the real authenticate middleware to run
// so that requests without a valid JWT are rejected with 401.

vi.mock('../../lib/feature-flags.js', () => ({
  requireFeature: () => async () => {},
}));

// Import after mocks
import discountController from '../../discount/discount.controller.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid() {
  return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
}

const EVENT_ID = uuid();
const VENDOR_ID = uuid();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Discount Controller — Authentication', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp(async (fastify) => {
      await fastify.register(discountController, { prefix: '/discount' });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Vendor routes require authenticate middleware ─────────────────────────

  describe('POST /discount/vendor/:vendorId/events/:eventId (protected)', () => {
    it('returns 401 when no auth token is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
        payload: { scope: 'EVENT', type: 'PERCENTAGE', value: 10 },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when an invalid JWT is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
        payload: { scope: 'EVENT', type: 'PERCENTAGE', value: 10 },
        cookies: { token: 'invalid.jwt.token' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 201 when a valid JWT is provided', async () => {
      const token = generateToken(app, {
        userId: uuid(),
        vendorId: VENDOR_ID,
        email: 'vendor@example.com',
        role: 'vendor',
      });

      const dbDiscount = makeDiscount({
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        scope: 'EVENT',
        type: 'PERCENTAGE',
        value: '10',
        created_by: 'VENDOR',
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbDiscount, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
        payload: { scope: 'EVENT', type: 'PERCENTAGE', value: 10 },
        cookies: { token },
      });

      expect(res.statusCode).toBe(201);
    });
  });

  describe('GET /discount/vendor/:vendorId/events/:eventId (protected)', () => {
    it('returns 401 when no auth token is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when an invalid JWT is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
        cookies: { token: 'bad-token' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 200 when a valid JWT is provided', async () => {
      const token = generateToken(app, {
        userId: uuid(),
        vendorId: VENDOR_ID,
        email: 'vendor@example.com',
        role: 'vendor',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
        cookies: { token },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── Organizer/shared routes do NOT require authenticate ──────────────────

  describe('POST /discount/organizer/events/:eventId (public)', () => {
    it('does not require authentication', async () => {
      const dbDiscount = makeDiscount({
        event_id: EVENT_ID,
        vendor_id: null,
        scope: 'EVENT',
        type: 'PERCENTAGE',
        value: '10',
        created_by: 'ORGANIZER',
        is_active: true,
      });

      // createDiscount + cache invalidation
      let callIndex = 0;
      supabaseMock.from.mockImplementation(() => {
        const mock = callIndex === 0
          ? createSupabaseMock({ data: dbDiscount, error: null })
          : createSupabaseMock({ data: [], error: null });
        callIndex++;
        return mock;
      });

      const res = await app.inject({
        method: 'POST',
        url: `/discount/organizer/events/${EVENT_ID}`,
        payload: { type: 'PERCENTAGE', value: 10 },
      });

      expect(res.statusCode).toBe(201);
    });
  });

  describe('GET /discount/organizer/events/:eventId (public)', () => {
    it('does not require authentication', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/discount/organizer/events/${EVENT_ID}`,
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('PATCH /discount/:id (public)', () => {
    it('does not require authentication', async () => {
      const discountId = uuid();
      const updatedDb = makeDiscount({
        id: discountId,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        is_active: false,
        value: '25',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: updatedDb, error: null }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: `/discount/${discountId}`,
        payload: { isActive: false },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('DELETE /discount/:id (public)', () => {
    it('does not require authentication', async () => {
      const discountId = uuid();
      const dbDiscount = makeDiscount({
        id: discountId,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbDiscount, error: null }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/discount/${discountId}`,
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── Input validation edge cases ──────────────────────────────────────────

  describe('POST /discount/organizer/events/:eventId — validation', () => {
    it('returns 400 when type is not a valid enum value', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/discount/organizer/events/${EVENT_ID}`,
        payload: { type: 'INVALID_TYPE', value: 10 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/discount/organizer/events/${EVENT_ID}`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when value is negative', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/discount/organizer/events/${EVENT_ID}`,
        payload: { type: 'FIXED', value: -5 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /discount/vendor/:vendorId/events/:eventId — validation', () => {
    it('returns 400 when scope is an invalid enum value (with valid auth)', async () => {
      const token = generateToken(app, {
        userId: uuid(),
        vendorId: VENDOR_ID,
        email: 'vendor@example.com',
        role: 'vendor',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
        payload: { scope: 'INVALID_SCOPE', type: 'PERCENTAGE', value: 10 },
        cookies: { token },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when PERCENTAGE value exceeds 100 (with valid auth)', async () => {
      const token = generateToken(app, {
        userId: uuid(),
        vendorId: VENDOR_ID,
        email: 'vendor@example.com',
        role: 'vendor',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
        payload: { scope: 'EVENT', type: 'PERCENTAGE', value: 101 },
        cookies: { token },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
