import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { cacheMock, redisMock } from '../mocks/redis.js';
import { makeVendor, makeMenuItem } from '../fixtures/index.js';
import { buildApp } from '../helpers/app.js';

// ── Module mocks (must be at top level) ──────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock }));

vi.mock('../../lib/redis.js', () => ({
  cache: cacheMock,
  default: redisMock,
  CACHE_TTL: {
    VENDOR_LIST: 3600,
    VENDOR_DETAILS: 60,
    MENU_ITEMS: 300,
    ACTIVE_ORDERS: 5,
  },
}));

// Import after mocks
import vendorController from '../../vendor/vendor.controller.js';

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VendorController — Extended Coverage', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = await buildApp(async (fastify) => {
      await fastify.register(vendorController, { prefix: '/vendor' });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /vendor/category ──────────────────────────────────────────────────

  describe('GET /vendor/category', () => {
    it('returns 200 with vendors filtered by category', async () => {
      const vendors = [makeVendor({ name: 'Pizza Place' })];

      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: vendors, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/category?category=Pizza',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendors');
      expect(Array.isArray(body.vendors)).toBe(true);
    });

    it('returns 200 with empty array when no vendors match category', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/category?category=NonExistentCategory',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().vendors).toHaveLength(0);
    });

    it('returns 500 when the service throws', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'DB error' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/category?category=Any',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /vendor/category/items ────────────────────────────────────────────

  describe('GET /vendor/category/items', () => {
    it('returns 200 with vendors that have items in the given category', async () => {
      const vendors = [makeVendor({ name: 'Burger Joint' })];

      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: vendors, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/category/items?categoryId=cat-123',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendors');
    });

    it('returns 200 with vendors filtered by eventCode', async () => {
      const vendors = [makeVendor()];

      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: vendors, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/category/items?categoryId=cat-123&eventCode=FEST2026',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('vendors');
    });

    it('returns 200 with an empty array when no vendors match', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/category/items?categoryId=no-match',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().vendors).toHaveLength(0);
    });

    it('returns 500 when the service throws', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'query failed' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/category/items?categoryId=cat-123',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor — Input Validation Edge Cases ────────────────────────────

  describe('POST /vendor — input validation edge cases', () => {
    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/vendor',
        payload: {
          phone: '0812345678',
          email: 'test@vendor.com',
          categoryId: 'cat-1',
          paymentMethods: ['CASH'],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/vendor',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('accepts optional fields like description and image_url', async () => {
      const dbVendor = makeVendor({
        id: 'new-v',
        name: 'Full Vendor',
        description: 'A fully described vendor',
        image_url: 'https://example.com/image.png',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor',
        payload: {
          name: 'Full Vendor',
          phone: '0812345678',
          email: 'full@vendor.com',
          categoryId: 'cat-1',
          paymentMethods: ['CASH'],
          description: 'A fully described vendor',
          imageUrl: 'https://example.com/image.png',
        },
      });

      expect(res.statusCode).toBe(201);
    });
  });

  // ── PATCH /vendor/:id/status — Edge Cases ─────────────────────────────────

  describe('PATCH /vendor/:id/status — edge cases', () => {
    it('returns 400 when isActive field is missing', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/vendor-1/status',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when isActive is a string instead of boolean', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/vendor-1/status',
        payload: { isActive: 'yes' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── PATCH /vendor/:id/pause — Edge Cases ──────────────────────────────────

  describe('PATCH /vendor/:id/pause — edge cases', () => {
    it('returns 400 when isPaused field is missing', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/vendor-1/pause',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 500 when the pause operation fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Pause error' } }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/vendor-1/pause',
        payload: { isPaused: true },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /vendor/search — Edge Cases ───────────────────────────────────────

  describe('GET /vendor/search — edge cases', () => {
    it('supports searching with eventId filter', async () => {
      const vendors = [makeVendor({ name: 'Searched Vendor' })];

      cacheMock.get.mockResolvedValueOnce(null);

      // searchVendors with eventId calls getEventByIdOrCode which does:
      // 1. events.select().eq('id', eventId).single() -> try by UUID first
      // 2. event_vendors.select('vendor_id').eq('event_id', ...) -> junction table
      // 3. vendors.select('*').eq('is_active', true).in('id', ...).or(...) -> search query
      const eventByIdMock = createSupabaseMock({ data: { id: 'event-abc' }, error: null });
      const junctionMock = createSupabaseMock({ data: [{ vendor_id: 'v1' }], error: null });
      const searchMock = createSupabaseMock({ data: vendors, error: null });

      mockFromSequence([eventByIdMock, junctionMock, searchMock]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/search?q=Searched&eventId=event-abc',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().vendors).toHaveLength(1);
    });

    it('handles special characters in the search query', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/vendor/search?q=${encodeURIComponent("'; DROP TABLE vendors; --")}`,
      });

      // Should handle safely via parameterized queries
      expect(res.statusCode).toBe(200);
    });

    it('returns 500 when the service throws', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Search failed' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/search?q=anything',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /vendor/:id/stats — Edge Cases ────────────────────────────────────

  describe('GET /vendor/:id/stats — edge cases', () => {
    it('returns 200 with zeroed stats when vendor has no orders', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-no-orders/stats',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalOrders).toBe(0);
      expect(body.totalRevenue).toBe(0);
    });

    it('returns 500 when the service throws', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Stats error' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-bad/stats',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /vendor/:id/menu — Edge Cases ─────────────────────────────────────

  describe('GET /vendor/:id/menu — edge cases', () => {
    it('returns 200 with empty menu when vendor has no menu items', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      const menuMock = createSupabaseMock({ data: [], error: null });
      const catMock = createSupabaseMock({ data: [], error: null });
      mockFromSequence([menuMock, catMock]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-empty/menu',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('menuItems');
      expect(body.menuItems).toHaveLength(0);
    });

    it('returns 500 when the service throws', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Menu error' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-bad/menu',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:id/menu — Input Validation Edge Cases ───────────────────

  describe('POST /vendor/:id/menu — input validation edge cases', () => {
    it('returns 400 when name is missing from the menu item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu',
        payload: { price: 50, categoryId: 'cat-1', type: 'FOOD' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when price is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu',
        payload: { name: 'No Price', categoryId: 'cat-1', type: 'FOOD' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── PATCH /vendor/:id/menu/:itemId/availability — Edge Cases ──────────────

  describe('PATCH /vendor/:id/menu/:itemId/availability — edge cases', () => {
    it('returns 400 when available field is missing', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/vendor-1/menu/item-1/availability',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('coerces string "true" to boolean and processes the request', async () => {
      // Fastify's Ajv coerces "true" to true for boolean schema fields,
      // so the request passes validation and reaches the service
      const item = makeMenuItem({ id: 'item-1', available: true });
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: item, error: null }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/vendor-1/menu/item-1/availability',
        payload: { available: 'true' },
      });

      // Fastify coerces "true" -> true, so the request is processed
      expect([200, 500]).toContain(res.statusCode);
    });
  });

  // ── GET /vendor/event/:eventId — Pagination Edge Cases ────────────────────

  describe('GET /vendor/event/:eventId — pagination edge cases', () => {
    it('uses default pagination when page and pageSize are not provided', async () => {
      const eventId = 'event-default-page';
      const vendorId = 'vendor-1';
      const dbVendors = [makeVendor({ id: vendorId })];

      cacheMock.get.mockResolvedValueOnce(null);

      const eventMock = createSupabaseMock({ data: { id: eventId }, error: null });
      const junctionMock = createSupabaseMock({ data: [{ vendor_id: vendorId }], error: null });
      const vendorsMock = createSupabaseMock({ data: dbVendors, error: null });
      vendorsMock.then = vi.fn((resolve) =>
        Promise.resolve(resolve({ data: dbVendors, error: null, count: 1 })),
      );
      const menuMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([eventMock, junctionMock, vendorsMock, menuMock]);

      const res = await app.inject({
        method: 'GET',
        url: `/vendor/event/${eventId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendors');
    });
  });
});
