import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { cacheMock, redisMock } from '../mocks/redis.js';
import { makeVendor, makeMenuItem, makeCategory, makeOrder } from '../fixtures/index.js';
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
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendors, error: null })
      );

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
      const dbMenuItems = [makeMenuItem({ vendor_id: vendorId, available: true })];

      cacheMock.get.mockResolvedValueOnce(null);

      const eventMock = createSupabaseMock({ data: { id: eventId }, error: null });
      const junctionMock = createSupabaseMock({ data: [{ vendor_id: vendorId }], error: null });
      const vendorsMock = createSupabaseMock({ data: dbVendors, error: null });
      vendorsMock.then = vi.fn((resolve) =>
        Promise.resolve(resolve({ data: dbVendors, error: null, count: 1 }))
      );
      const menuMock = createSupabaseMock({ data: dbMenuItems, error: null });

      mockFromSequence([eventMock, junctionMock, vendorsMock, menuMock]);

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
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

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

  // ── GET /vendor/:id/menu ──────────────────────────────────────────────────────

  describe('GET /vendor/:id/menu', () => {
    it('returns 200 with { menuItems } (grouped by category)', async () => {
      const categoryId = 'cat-1';
      const dbItems = [
        makeMenuItem({ vendor_id: 'vendor-1', category_id: categoryId, available: true }),
      ];
      const dbCategories = [{ id: categoryId, name: 'Mains' }];

      cacheMock.get.mockResolvedValueOnce(null);
      const menuMock = createSupabaseMock({ data: dbItems, error: null });
      const catMock = createSupabaseMock({ data: dbCategories, error: null });
      mockFromSequence([menuMock, catMock]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('menuItems');
      expect(Array.isArray(body.menuItems)).toBe(true);
      expect(body.menuItems[0]).toHaveProperty('category');
      expect(body.menuItems[0]).toHaveProperty('menuItems');
    });
  });

  // ── GET /vendor/:id/menu/:itemId ──────────────────────────────────────────────

  describe('GET /vendor/:id/menu/:itemId', () => {
    it('returns 200 with { menuItem } when found', async () => {
      // Route schema requires UUIDs for :id and :itemId
      const vendorId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const dbItem = makeMenuItem({ id: itemId, vendor_id: vendorId });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const res = await app.inject({
        method: 'GET',
        url: `/vendor/${vendorId}/menu/${itemId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('menuItem');
      expect(body.menuItem.id).toBe(itemId);
    });

    it('returns 404 when menu item is not found', async () => {
      // Route schema requires UUIDs for :id and :itemId
      const vendorId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const mock = createSupabaseMock({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });
      supabaseMock.from.mockReturnValue(mock);

      const res = await app.inject({
        method: 'GET',
        url: `/vendor/${vendorId}/menu/${itemId}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Menu item not found' });
    });
  });

  // ── POST /vendor ──────────────────────────────────────────────────────────────

  describe('POST /vendor', () => {
    it('returns 201 with { vendor } on successful creation', async () => {
      const dbVendor = makeVendor({ id: 'new-vendor', name: 'Brand New Vendor' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

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
          categoryId: 'cat-1',
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
          categoryId: 'cat-1',
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

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

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

  // ── POST /vendor/:id/menu ─────────────────────────────────────────────────────

  describe('POST /vendor/:id/menu', () => {
    it('returns 201 with { menuItem } on successful creation', async () => {
      const dbItem = makeMenuItem({
        id: 'new-menu-item',
        vendor_id: 'vendor-1',
        category_id: 'cat-1',
        name: 'Cheese Burger',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu',
        payload: {
          name: 'Cheese Burger',
          price: 90,
          type: 'FOOD',
          available: true,
          categoryId: 'cat-1',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('menuItem');
      expect(body.menuItem.name).toBe('Cheese Burger');
    });

    it('returns 500 when menu item creation fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Insert failed' } })
      );

      // Must send a valid body to pass schema validation
      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu',
        payload: { name: 'Bad Item', price: 50, categoryId: 'cat-1', type: 'FOOD' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PUT /vendor/:id/menu/:itemId ──────────────────────────────────────────────

  describe('PUT /vendor/:id/menu/:itemId', () => {
    it('returns 200 with { menuItem } on successful update', async () => {
      const dbItem = makeMenuItem({
        id: 'item-1',
        vendor_id: 'vendor-1',
        category_id: 'cat-1',
        name: 'Updated Item',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/item-1',
        payload: { name: 'Updated Item', price: 95 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('menuItem');
      expect(body.menuItem.name).toBe('Updated Item');
    });

    it('returns 500 when menu item update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Update failed' } })
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/bad-item',
        payload: { name: 'X' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PATCH /vendor/:id/menu/:itemId/availability ───────────────────────────────

  describe('PATCH /vendor/:id/menu/:itemId/availability', () => {
    it('returns 200 with { menuItem } after toggling availability', async () => {
      const dbItem = makeMenuItem({
        id: 'item-1',
        vendor_id: 'vendor-1',
        category_id: 'cat-1',
        available: false,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/vendor-1/menu/item-1/availability',
        payload: { available: false },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('menuItem');
    });

    it('returns 500 when availability toggle fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Toggle failed' } })
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/vendor/vendor-1/menu/bad-item/availability',
        payload: { available: true },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── DELETE /vendor/:id/menu/:itemId ───────────────────────────────────────────

  describe('DELETE /vendor/:id/menu/:itemId', () => {
    it('returns 204 on successful menu item deletion', async () => {
      const fetchMock = createSupabaseMock({
        data: { vendor_id: 'vendor-1', category_id: 'cat-1' },
        error: null,
      });
      const deleteMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([fetchMock, deleteMock]);

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/item-to-delete',
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 500 when menu item deletion fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Item not found' } })
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/bad-item',
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
