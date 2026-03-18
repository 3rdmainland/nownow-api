import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { cacheMock, redisMock } from '../mocks/redis.js';
import { makeVendor, makeDefaultMenuItem, makeCategory, makeOrder } from '../fixtures/index.js';
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
  responses: Array<ReturnType<typeof createSupabaseMock>>
) {
  let callIndex = 0;
  supabaseMock.from.mockImplementation(() => {
    const mock = responses[callIndex] ?? createSupabaseMock({ data: null, error: null });
    callIndex++;
    return mock;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VendorController (integration)', () => {
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

  // ── GET /vendor ──────────────────────────────────────────────────────────────

  describe('GET /vendor', () => {
    it('returns 200 with { vendors } array', async () => {
      const dbVendors = [makeVendor({ name: 'Vendor A' }), makeVendor({ name: 'Vendor B' })];

      cacheMock.get.mockResolvedValueOnce(null);
      // 1st: vendors, 2nd: enrichWithCategories
      mockFromSequence([
        createSupabaseMock({ data: dbVendors, error: null }),
        createSupabaseMock({ data: [], error: null }),
      ]);

      const res = await app.inject({ method: 'GET', url: '/vendor' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendors');
      expect(body.vendors).toHaveLength(2);
    });

    it('returns 500 when service throws', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'DB error' } })
      );

      const res = await app.inject({ method: 'GET', url: '/vendor' });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toHaveProperty('error');
    });
  });

  // ── GET /vendor/search?q=... ─────────────────────────────────────────────────

  describe('GET /vendor/search', () => {
    it('returns 200 with { vendors } matching search term', async () => {
      const dbVendors = [makeVendor({ name: 'Pizza House' })];

      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendors, error: null })
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/search?q=pizza',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendors');
      expect(body.vendors[0].name).toBe('Pizza House');
    });

    it('returns 200 with empty vendors when no matches', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null })
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/search?q=xyznotexists',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().vendors).toHaveLength(0);
    });
  });

  // ── GET /vendor/event/:eventId ───────────────────────────────────────────────

  describe('GET /vendor/event/:eventId', () => {
    it('returns 200 with paginated vendors and metadata', async () => {
      const eventId = 'event-abc';
      const vendorId = 'vendor-1';
      const dbVendors = [makeVendor({ id: vendorId })];
      const dbMenuItems = [makeDefaultMenuItem({ vendor_id: vendorId })];

      cacheMock.get.mockResolvedValueOnce(null);

      const eventMock = createSupabaseMock({ data: { id: eventId }, error: null });
      const junctionMock = createSupabaseMock({ data: [{ vendor_id: vendorId }], error: null });
      const vendorsMock = createSupabaseMock({ data: dbVendors, error: null });
      vendorsMock.then = vi.fn((resolve) =>
        Promise.resolve(resolve({ data: dbVendors, error: null, count: 1 }))
      );
      const enrichMock = createSupabaseMock({ data: [], error: null });
      const menuMock = createSupabaseMock({ data: dbMenuItems, error: null });

      mockFromSequence([eventMock, junctionMock, vendorsMock, enrichMock, menuMock]);

      const res = await app.inject({
        method: 'GET',
        url: `/vendor/event/${eventId}?page=1&pageSize=10`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendors');
      expect(body).toHaveProperty('page', 1);
      expect(body).toHaveProperty('pageSize', 10);
    });

    it('returns 500 when event is not found', async () => {
      cacheMock.get.mockResolvedValueOnce(null);

      // Both ID and code lookups fail
      const notFoundMock = createSupabaseMock({ data: null, error: { message: 'Not found' } });
      mockFromSequence([notFoundMock, notFoundMock]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/event/bad-event',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /vendor/:id ──────────────────────────────────────────────────────────

  describe('GET /vendor/:id', () => {
    it('returns 200 with { vendor } when found', async () => {
      const dbVendor = makeVendor({ id: 'vendor-found', name: 'Found Vendor' });

      cacheMock.get.mockResolvedValueOnce(null);
      // 1st: vendor, 2nd: enrichWithCategories
      mockFromSequence([
        createSupabaseMock({ data: dbVendor, error: null }),
        createSupabaseMock({ data: [], error: null }),
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-found',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendor');
      expect(body.vendor.name).toBe('Found Vendor');
    });

    it('returns 404 when vendor is not found', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null })
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/nonexistent-id',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Vendor not found' });
    });
  });

  // ── GET /vendor/:id/stats ─────────────────────────────────────────────────────

  describe('GET /vendor/:id/stats', () => {
    it('returns 200 with stats object', async () => {
      const dbOrders = [
        makeOrder({ vendor_id: 'vendor-1', total: 100, status: 'PENDING', created_at: new Date().toISOString() }),
        makeOrder({ vendor_id: 'vendor-1', total: 200, status: 'COMPLETED', created_at: new Date().toISOString() }),
      ];

      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbOrders, error: null })
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/stats',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('totalOrders');
      expect(body).toHaveProperty('totalRevenue');
      expect(body).toHaveProperty('averageRating');
      expect(body).toHaveProperty('todayOrders');
      expect(body).toHaveProperty('activeOrders');
      expect(body.totalOrders).toBe(2);
      expect(body.totalRevenue).toBe(300);
    });
  });

  // ── POST /vendor ──────────────────────────────────────────────────────────────

  describe('POST /vendor', () => {
    it('returns 201 with { vendor } on successful creation', async () => {
      const dbVendor = makeVendor({ id: 'new-vendor', name: 'Brand New Vendor' });
      const dbVendorWithCats = makeVendor({
        id: 'new-vendor',
        name: 'Brand New Vendor',
        vendor_categories: [{ category_id: 'cat-1', categories: { id: 'cat-1', name: 'Food' } }],
      });

      // 1. insert vendor, 2. delete old cats, 3. insert cats, 4. fetch with cats
      mockFromSequence([
        createSupabaseMock({ data: dbVendor, error: null }),
        createSupabaseMock({ data: null, error: null }),
        createSupabaseMock({ data: null, error: null }),
        createSupabaseMock({ data: dbVendorWithCats, error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor',
        payload: {
          name: 'Brand New Vendor',
          phone: '0812345678',
          email: 'new@vendor.com',
          isActive: true,
          isPaused: false,
          paymentMethods: ['CASH'],
          categoryIds: ['cat-1'],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('vendor');
      expect(body.vendor.name).toBe('Brand New Vendor');
    });

    it('returns 500 when creation fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'DB error' } })
      );

      // Must send a valid body to pass schema validation, so the service actually runs
      const res = await app.inject({
        method: 'POST',
        url: '/vendor',
        payload: {
          name: 'Fail Vendor',
          phone: '0812345678',
          email: 'fail@vendor.com',
          categoryIds: ['cat-1'],
          paymentMethods: ['CASH'],
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PUT /vendor/:id ──────────────────────────────────────────────────────────

  describe('PUT /vendor/:id', () => {
    it('returns 200 with { vendor } on successful update', async () => {
      const dbVendor = makeVendor({ id: 'vendor-update', name: 'Updated Vendor' });

      // 1. update vendor row, 2. fetch with categories
      mockFromSequence([
        createSupabaseMock({ data: dbVendor, error: null }),
        createSupabaseMock({ data: dbVendor, error: null }),
      ]);

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-update',
        payload: { name: 'Updated Vendor' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendor');
      expect(body.vendor.name).toBe('Updated Vendor');
    });

    it('returns 500 when update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Not found' } })
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/missing-vendor',
        payload: { name: 'X' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PATCH /vendor/:id/status ──────────────────────────────────────────────────

  describe('PATCH /vendor/:id/status', () => {
    it('returns 200 with { vendor } after toggling status', async () => {
      const dbVendor = makeVendor({ id: 'vendor-status', is_active: true });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/vendor-status/status',
        payload: { isActive: true },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendor');
    });

    it('returns 500 when status toggle fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Toggle error' } })
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/bad-vendor/status',
        payload: { isActive: false },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PATCH /vendor/:id/pause ───────────────────────────────────────────────────

  describe('PATCH /vendor/:id/pause', () => {
    it('returns 200 with { vendor } after pausing', async () => {
      const dbVendor = makeVendor({ id: 'vendor-pause', is_paused: true });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/vendor-pause/pause',
        payload: { isPaused: true },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendor');
    });

    it('returns 200 with { vendor } after unpausing', async () => {
      const dbVendor = makeVendor({ id: 'vendor-pause', is_paused: false });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/vendor-pause/pause',
        payload: { isPaused: false },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().vendor).toBeDefined();
    });
  });

  // ── DELETE /vendor/:id ────────────────────────────────────────────────────────

  describe('DELETE /vendor/:id', () => {
    it('returns 204 on successful deletion', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null })
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-to-delete',
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 500 when deletion fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Cannot delete' } })
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/locked-vendor',
      });

      expect(res.statusCode).toBe(500);
    });
  });

});
