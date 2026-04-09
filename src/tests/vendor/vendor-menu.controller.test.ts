import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { cacheMock, redisMock } from '../mocks/redis.js';
import { buildApp } from '../helpers/app.js';

// ── Module mocks (must be at top level) ──────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));

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

vi.mock('../../websocket/index.js', () => ({
  broadcastPriceUpdate: vi.fn(),
  broadcastAvailabilityUpdate: vi.fn(),
}));

vi.mock('../../discount/discount.service.js', () => ({
  DiscountService: vi.fn(function() {
    return {
      resolveDiscountsForMenu: vi.fn().mockResolvedValue(new Map()),
    };
  }),
}));

// Import after mocks
import vendorMenuController from '../../vendor/menu/vendor-menu.controller.js';

// ── Fixture factories ─────────────────────────────────────────────────────────

const makeDefaultMenuItem = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  vendor_id: 'vendor-1',
  category_id: 'cat-1',
  sku: null,
  name: 'Test Item',
  slug: 'test-item',
  description: 'A test item',
  short_description: null,
  image_url: null,
  type: 'FOOD',
  base_price: 100,
  cost_price: null,
  pricing_strategy: 'FIXED',
  prep_time: 10,
  cooking_instructions: null,
  track_inventory: false,
  stock_quantity: null,
  low_stock_threshold: null,
  availability_status: 'AVAILABLE',
  tag_ids: [],
  modifier_group_ids: [],
  display_order: 0,
  is_featured: false,
  is_popular: false,
  nutritional_info: null,
  is_active: true,
  scope: 'DEFAULT',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const makeEventMenuItem = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  event_id: 'event-1',
  vendor_id: 'vendor-1',
  default_menu_item_id: crypto.randomUUID(),
  price_override: null,
  availability_override: null,
  prep_time_override: null,
  stock_quantity_override: null,
  is_included: true,
  display_order_override: null,
  is_featured_at_event: false,
  max_orders_per_customer: null,
  max_total_orders: null,
  current_order_count: 0,
  available_from: null,
  available_to: null,
  event_notes: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const makeDbEventMenuConfig = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  event_id: 'event-1',
  vendor_id: 'vendor-1',
  template_id: null,
  is_accepting_orders: true,
  max_concurrent_orders: null,
  current_active_orders: 0,
  order_cooldown_minutes: null,
  max_orders_per_customer_event: null,
  event_open_time: null,
  event_close_time: null,
  operating_schedule: null,
  global_price_adjustment: null,
  minimum_order_value: null,
  service_fee_percent: null,
  prep_time_buffer_minutes: null,
  estimated_wait_minutes: null,
  booth_info: null,
  vendor_notice: null,
  status: 'DRAFT',
  published_at: null,
  category_configurations: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const makeDbMenuCategory = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  vendor_id: 'vendor-1',
  parent_id: null,
  name: 'Burgers',
  slug: 'burgers',
  description: null,
  image_url: null,
  display_order: 0,
  is_active: true,
  schedule_start: null,
  schedule_end: null,
  available_days: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const makeDbModifierGroup = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  vendor_id: 'vendor-1',
  name: 'Size',
  description: null,
  selection_type: 'SINGLE',
  is_required: false,
  min_selections: 0,
  max_selections: 1,
  display_order: 0,
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

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

describe('VendorMenuController (integration)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = await buildApp(async (fastify) => {
      // The controller uses /:vendorId/menu/... routes
      // We register it with /vendor prefix to match the spec
      await fastify.register(vendorMenuController, { prefix: '/vendor' });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /vendor/:vendorId/menu/default ─────────────────────────────────────

  describe('GET /vendor/:vendorId/menu/default', () => {
    it('returns 200 with default menu', async () => {
      const vendorId = 'vendor-1';
      const cachedMenu = {
        vendor: { id: vendorId, name: 'Test Vendor' },
        categories: [],
        menuItems: [],
        modifierGroups: [],
        tags: [],
      };
      cacheMock.get.mockResolvedValueOnce(cachedMenu);

      const res = await app.inject({
        method: 'GET',
        url: `/vendor/${vendorId}/menu/default`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendor');
      expect(body).toHaveProperty('categories');
      expect(body).toHaveProperty('menuItems');
    });

    it('returns 500 when service throws', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'DB error' } })
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/default',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/default/items ──────────────────────────────

  describe('POST /vendor/:vendorId/menu/default/items', () => {
    it('returns 201 with { menuItem } on successful creation', async () => {
      const dbItem = makeDefaultMenuItem({ name: 'Cheese Burger' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/default/items',
        payload: {
          name: 'Cheese Burger',
          categoryId: 'cat-1',
          type: 'FOOD',
          basePrice: 90,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('menuItem');
      expect(body.menuItem.name).toBe('Cheese Burger');
    });

    it('returns 400 when validation fails', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/default/items',
        payload: {
          name: '',          // invalid: empty
          categoryId: 'cat-1',
          type: 'FOOD',
          basePrice: -5,    // invalid: negative price
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 500 when item creation fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Insert failed' } })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/default/items',
        payload: {
          name: 'Valid Item',
          categoryId: 'cat-1',
          type: 'FOOD',
          basePrice: 80,
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PUT /vendor/:vendorId/menu/default/items/:itemId ──────────────────────

  describe('PUT /vendor/:vendorId/menu/default/items/:itemId', () => {
    it('returns 200 with { menuItem } on successful update', async () => {
      const dbItem = makeDefaultMenuItem({ name: 'Updated Burger' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/default/items/item-1',
        payload: { name: 'Updated Burger', basePrice: 95 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('menuItem');
      expect(body.menuItem.name).toBe('Updated Burger');
    });

    it('returns 500 when update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Update error' } })
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/default/items/bad-item',
        payload: { name: 'X' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── DELETE /vendor/:vendorId/menu/default/items/:itemId ───────────────────

  describe('DELETE /vendor/:vendorId/menu/default/items/:itemId', () => {
    it('returns 204 on successful deletion', async () => {
      // event_menu_items check (no references)
      const eventItemsMock = createSupabaseMock({ data: [], error: null });
      // delete
      const deleteMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([eventItemsMock, deleteMock]);

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/default/items/item-to-delete',
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 500 when deletion fails', async () => {
      const eventItemsMock = createSupabaseMock({ data: [], error: null });
      const deleteMock = createSupabaseMock({ data: null, error: { message: 'Delete failed' } });

      mockFromSequence([eventItemsMock, deleteMock]);

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/default/items/locked-item',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/default/items/bulk ────────────────────────

  describe('POST /vendor/:vendorId/menu/default/items/bulk', () => {
    it('returns 201 with { menuItems, count } on successful bulk creation', async () => {
      const dbItems = [
        makeDefaultMenuItem({ name: 'Item 1' }),
        makeDefaultMenuItem({ name: 'Item 2' }),
      ];

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItems, error: null })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/default/items/bulk',
        payload: {
          items: [
            { name: 'Item 1', categoryId: 'cat-1', type: 'FOOD', basePrice: 80 },
            { name: 'Item 2', categoryId: 'cat-1', type: 'FOOD', basePrice: 90 },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('menuItems');
      expect(body).toHaveProperty('count', 2);
    });

    it('returns 400 when any item fails validation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/default/items/bulk',
        payload: {
          items: [
            { name: 'Valid', categoryId: 'cat-1', type: 'FOOD', basePrice: 80 },
            { name: '', categoryId: 'cat-1', type: 'FOOD', basePrice: -5 },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /vendor/:vendorId/menu/events/:eventId ────────────────────────────

  describe('GET /vendor/:vendorId/menu/events/:eventId', () => {
    it('returns 200 with event menu on cache hit', async () => {
      const cachedMenu = {
        event: { id: 'event-1', name: 'Test Event', startDate: '', endDate: '' },
        vendor: { id: 'vendor-1', name: 'Test Vendor' },
        configuration: makeDbEventMenuConfig(),
        categories: [],
        menuItems: [],
        modifierGroups: [],
        tags: [],
      };
      cacheMock.get.mockResolvedValueOnce(cachedMenu);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/event-1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('event');
      expect(body).toHaveProperty('vendor');
      expect(body).toHaveProperty('menuItems');
    });

    it('returns 500 when service throws', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Event not found' } })
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/bad-event',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/events/:eventId/items ────────────────────

  describe('POST /vendor/:vendorId/menu/events/:eventId/items', () => {
    it('returns 201 with { eventMenuItem } on successful upsert', async () => {
      const defaultItemId = 'default-item-1';
      const dbEventItem = makeEventMenuItem({
        default_menu_item_id: defaultItemId,
        vendor_id: 'vendor-1',
        event_id: 'event-1',
      });

      // Existing lookup (not found)
      const existingMock = createSupabaseMock({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });
      // Insert
      const insertMock = createSupabaseMock({ data: dbEventItem, error: null });

      mockFromSequence([existingMock, insertMock]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/items',
        payload: {
          defaultMenuItemId: defaultItemId,
          isIncluded: true,
          isFeaturedAtEvent: false,
          currentOrderCount: 0,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('eventMenuItem');
    });

    it('returns 500 when upsert fails', async () => {
      const existingMock = createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'Not found' } });
      const insertMock = createSupabaseMock({ data: null, error: { message: 'Insert failed' } });

      mockFromSequence([existingMock, insertMock]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/items',
        payload: {
          defaultMenuItemId: 'item-1',
          isIncluded: true,
          isFeaturedAtEvent: false,
          currentOrderCount: 0,
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /vendor/:vendorId/menu/events/:eventId/config ────────────────────

  describe('GET /vendor/:vendorId/menu/events/:eventId/config', () => {
    it('returns 200 with { configuration } when config exists', async () => {
      const dbConfig = makeDbEventMenuConfig({ vendor_id: 'vendor-1', event_id: 'event-1' });

      // getOrCreateEventMenuConfig: config found
      const configMock = createSupabaseMock({ data: dbConfig, error: null });
      const eventItemsMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([configMock, eventItemsMock]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/event-1/config',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('configuration');
      expect(body.configuration).toHaveProperty('vendorId');
    });

    it('returns 200 and creates new config when none exists', async () => {
      const newConfig = makeDbEventMenuConfig({
        vendor_id: 'vendor-1',
        event_id: 'event-new',
        status: 'DRAFT',
      });

      // Config not found
      const notFoundMock = createSupabaseMock({
        data: null,
        error: { code: 'PGRST116', message: 'No rows' },
      });
      // Insert new config
      const insertMock = createSupabaseMock({ data: newConfig, error: null });

      mockFromSequence([notFoundMock, insertMock]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/event-new/config',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configuration.status).toBe('DRAFT');
    });
  });

  // ── PUT /vendor/:vendorId/menu/events/:eventId/config ────────────────────

  describe('PUT /vendor/:vendorId/menu/events/:eventId/config', () => {
    it('returns 200 with { configuration } after update', async () => {
      const dbConfig = makeDbEventMenuConfig({
        vendor_id: 'vendor-1',
        event_id: 'event-1',
        is_accepting_orders: false,
      });

      const updateMock = createSupabaseMock({ data: dbConfig, error: null });
      const eventItemsMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([updateMock, eventItemsMock]);

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/events/event-1/config',
        payload: { isAcceptingOrders: false },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('configuration');
    });

    it('returns 500 when config update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Config update failed' } })
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/events/event-1/config',
        payload: { isAcceptingOrders: true },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/events/:eventId/publish ──────────────────

  describe('POST /vendor/:vendorId/menu/events/:eventId/publish', () => {
    it('returns 200 with { configuration } with status PUBLISHED', async () => {
      const dbConfig = makeDbEventMenuConfig({
        vendor_id: 'vendor-1',
        event_id: 'event-1',
        status: 'PUBLISHED',
        published_at: new Date().toISOString(),
      });

      const updateMock = createSupabaseMock({ data: dbConfig, error: null });
      const eventItemsMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([updateMock, eventItemsMock]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/publish',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('configuration');
      expect(body.configuration.status).toBe('PUBLISHED');
    });

    it('returns 500 when publish fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Publish failed' } })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/publish',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /vendor/:vendorId/menu/categories ─────────────────────────────────

  describe('GET /vendor/:vendorId/menu/categories', () => {
    it('returns 200 with { categories } array', async () => {
      const dbCategories = [
        makeDbMenuCategory({ name: 'Mains' }),
        makeDbMenuCategory({ name: 'Drinks' }),
      ];

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbCategories, error: null })
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/categories',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('categories');
      expect(body.categories).toHaveLength(2);
    });

    it('returns 200 with empty categories array', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null })
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/categories',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().categories).toHaveLength(0);
    });
  });

  // ── POST /vendor/:vendorId/menu/categories ────────────────────────────────

  describe('POST /vendor/:vendorId/menu/categories', () => {
    it('returns 201 with { category } on successful creation', async () => {
      const dbCategory = makeDbMenuCategory({ name: 'Desserts' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbCategory, error: null })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/categories',
        payload: {
          name: 'Desserts',
          displayOrder: 3,
          isActive: true,
          slug: 'desserts',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('category');
      expect(body.category.name).toBe('Desserts');
    });

    it('returns 500 when category creation fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Duplicate slug' } })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/categories',
        payload: { name: 'Mains', displayOrder: 0, isActive: true, slug: 'mains' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /vendor/:vendorId/menu/modifier-groups ────────────────────────────

  describe('GET /vendor/:vendorId/menu/modifier-groups', () => {
    it('returns 200 with { modifierGroups } array', async () => {
      const groupId = 'group-1';
      const dbGroups = [makeDbModifierGroup({ id: groupId, name: 'Size' })];

      // all groups + filtered groups + modifiers
      const allGroupsMock = createSupabaseMock({ data: dbGroups, error: null });
      const filteredGroupsMock = createSupabaseMock({ data: dbGroups, error: null });
      const modifiersMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([allGroupsMock, filteredGroupsMock, modifiersMock]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/modifier-groups',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('modifierGroups');
      expect(body.modifierGroups).toHaveLength(1);
      expect(body.modifierGroups[0].name).toBe('Size');
    });

    it('returns 200 with empty array when no modifier groups', async () => {
      const allGroupsMock = createSupabaseMock({ data: [], error: null });
      const filteredGroupsMock = createSupabaseMock({ data: [], error: null });
      const modifiersMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([allGroupsMock, filteredGroupsMock, modifiersMock]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/modifier-groups',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().modifierGroups).toHaveLength(0);
    });
  });

  // ── POST /vendor/:vendorId/menu/modifier-groups ───────────────────────────

  describe('POST /vendor/:vendorId/menu/modifier-groups', () => {
    it('returns 201 with { modifierGroup } on successful creation', async () => {
      const dbGroup = makeDbModifierGroup({ name: 'Toppings' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbGroup, error: null })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/modifier-groups',
        payload: {
          name: 'Toppings',
          selectionType: 'MULTIPLE',
          isRequired: false,
          minSelections: 0,
          maxSelections: 5,
          displayOrder: 0,
          isActive: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('modifierGroup');
      expect(body.modifierGroup.name).toBe('Toppings');
    });

    it('returns 500 when group creation fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Duplicate group' } })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/modifier-groups',
        payload: {
          name: 'Size',
          selectionType: 'SINGLE',
          isRequired: false,
          minSelections: 0,
          maxSelections: 1,
          displayOrder: 0,
          isActive: true,
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/events/:eventId/price-adjustment ──────────

  describe('POST /vendor/:vendorId/menu/events/:eventId/price-adjustment', () => {
    it('returns 200 with { updatedCount } on successful adjustment', async () => {
      const dbItems = [
        { id: 'item-1', base_price: 100, name: 'Burger' },
        { id: 'item-2', base_price: 50, name: 'Fries' },
      ];

      const itemsMock = createSupabaseMock({ data: dbItems, error: null });
      const upsertMock1 = createSupabaseMock({ data: null, error: null });
      const upsertMock2 = createSupabaseMock({ data: null, error: null });

      mockFromSequence([itemsMock, upsertMock1, upsertMock2]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/price-adjustment',
        payload: {
          adjustment: {
            type: 'PERCENTAGE',
            value: 10,
            direction: 'INCREASE',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('updatedCount');
      expect(body.updatedCount).toBe(2);
    });

    it('returns 200 with updatedCount=0 when no items match', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/price-adjustment',
        payload: {
          adjustment: {
            type: 'FIXED',
            value: 20,
            direction: 'DECREASE',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().updatedCount).toBe(0);
    });

    it('returns 500 when price adjustment fails', async () => {
      // The service silently swallows DB errors; throw synchronously to trigger the catch block
      supabaseMock.from.mockImplementation(() => { throw new Error('DB connection failed'); });

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/price-adjustment',
        payload: {
          adjustment: {
            type: 'PERCENTAGE',
            value: 10,
            direction: 'INCREASE',
          },
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/events/:eventId/clone ────────────────────

  describe('POST /vendor/:vendorId/menu/events/:eventId/clone', () => {
    it('returns 200 with { clonedCount } on successful clone', async () => {
      const sourceItems = [
        makeEventMenuItem({ vendor_id: 'vendor-1', event_id: 'event-source' }),
        makeEventMenuItem({ vendor_id: 'vendor-1', event_id: 'event-source' }),
      ];

      // Source items fetch
      const sourceMock = createSupabaseMock({ data: sourceItems, error: null });
      // Batch upsert returns upserted items
      const upsertMock = createSupabaseMock({ data: sourceItems, error: null });

      mockFromSequence([sourceMock, upsertMock]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-target/clone',
        payload: {
          sourceEventId: 'event-source',
          includeOverrides: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('clonedCount');
      expect(body.clonedCount).toBe(2);
    });

    it('returns 200 with clonedCount=0 when source event is empty', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-target/clone',
        payload: {
          sourceEventId: 'empty-source-event',
          includeOverrides: false,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().clonedCount).toBe(0);
    });

    it('returns 500 when clone operation fails', async () => {
      // The service silently swallows DB errors; throw synchronously to trigger the catch block
      supabaseMock.from.mockImplementation(() => { throw new Error('DB connection failed'); });

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-target/clone',
        payload: {
          sourceEventId: 'bad-event',
          includeOverrides: false,
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
