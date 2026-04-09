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
  DiscountService: vi.fn(function () {
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

const makeDbTag = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  name: 'Spicy',
  slug: 'spicy',
  color: '#FF0000',
  icon: null,
  category: 'DIETARY',
  is_active: true,
  created_at: new Date().toISOString(),
  ...overrides,
});

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

describe('VendorMenuController — Complex Multi-Step Endpoints', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    cacheMock.get.mockResolvedValue(null); // cache miss by default
    app = await buildApp(async (fastify) => {
      await fastify.register(vendorMenuController, { prefix: '/vendor' });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GET /vendor/:vendorId/menu/default — getDefaultMenu
  // DB sequence: vendor → categories → items → modifierGroups(allGroups, filteredGroups, modifiers) → tags
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /vendor/:vendorId/menu/default', () => {
    it('returns 200 with complete default menu (vendor, categories, items, modifierGroups, tags)', async () => {
      const vendor = { id: 'vendor-1', name: 'Test Vendor' };
      const categories = [makeDbMenuCategory({ id: 'cat-1', name: 'Mains' })];
      const items = [makeDefaultMenuItem({ id: 'item-1', name: 'Burger', category_id: 'cat-1' })];
      const allGroups = [makeDbModifierGroup({ id: 'grp-1' })];
      const filteredGroups = [makeDbModifierGroup({ id: 'grp-1' })];
      const modifiers = [{ id: 'mod-1', group_id: 'grp-1', name: 'Large', price_adjustment: 20, is_default: false, is_available: true, display_order: 0, nutritional_info: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
      const tags = [makeDbTag({ id: 'tag-1', name: 'Spicy' })];

      // getDefaultMenu sequence:
      // 1. vendors (single)
      // 2. menu_categories
      // 3. default_menu_items
      // 4. modifier_groups (all - debug query)
      // 5. modifier_groups (filtered by vendor)
      // 6. modifiers (in group_ids)
      // 7. menu_tags
      mockFromSequence([
        createSupabaseMock({ data: vendor, error: null }),         // vendor
        createSupabaseMock({ data: categories, error: null }),     // categories
        createSupabaseMock({ data: items, error: null }),          // items
        createSupabaseMock({ data: allGroups, error: null }),      // modifier_groups (all)
        createSupabaseMock({ data: filteredGroups, error: null }), // modifier_groups (filtered)
        createSupabaseMock({ data: modifiers, error: null }),      // modifiers
        createSupabaseMock({ data: tags, error: null }),           // tags
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/default',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('vendor');
      expect(body.vendor.id).toBe('vendor-1');
      expect(body.vendor.name).toBe('Test Vendor');
      expect(body).toHaveProperty('categories');
      expect(body.categories).toHaveLength(1);
      expect(body).toHaveProperty('menuItems');
      expect(body.menuItems).toHaveLength(1);
      expect(body).toHaveProperty('modifierGroups');
      expect(body).toHaveProperty('tags');
    });

    it('returns cached response when cache hit', async () => {
      const cachedMenu = {
        vendor: { id: 'vendor-1', name: 'Cached Vendor' },
        categories: [],
        menuItems: [],
        modifierGroups: [],
        tags: [],
      };
      cacheMock.get.mockResolvedValue(cachedMenu);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/default',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.vendor.name).toBe('Cached Vendor');
      // supabase.from should NOT have been called
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('returns 200 with empty categories and items', async () => {
      const vendor = { id: 'vendor-1', name: 'Empty Vendor' };

      mockFromSequence([
        createSupabaseMock({ data: vendor, error: null }),     // vendor
        createSupabaseMock({ data: [], error: null }),         // categories (empty)
        createSupabaseMock({ data: [], error: null }),         // items (empty)
        createSupabaseMock({ data: [], error: null }),         // modifier_groups (all)
        createSupabaseMock({ data: [], error: null }),         // modifier_groups (filtered)
        createSupabaseMock({ data: [], error: null }),         // modifiers
        createSupabaseMock({ data: [], error: null }),         // tags
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/default',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.categories).toHaveLength(0);
      expect(body.menuItems).toHaveLength(0);
    });

    it('returns 500 when vendor fetch fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'DB error' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/default',
      });

      expect(res.statusCode).toBe(500);
    });

    it('sets cache after successful fetch', async () => {
      const vendor = { id: 'vendor-1', name: 'Test Vendor' };

      mockFromSequence([
        createSupabaseMock({ data: vendor, error: null }),
        createSupabaseMock({ data: [], error: null }),
        createSupabaseMock({ data: [], error: null }),
        createSupabaseMock({ data: [], error: null }),
        createSupabaseMock({ data: [], error: null }),
        createSupabaseMock({ data: [], error: null }),
        createSupabaseMock({ data: [], error: null }),
      ]);

      await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/default',
      });

      expect(cacheMock.set).toHaveBeenCalledWith(
        'menu:default:vendor-1',
        expect.objectContaining({ vendor: expect.any(Object) }),
        300,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GET /vendor/:vendorId/menu/events/:eventId — getEventMenu
  // DB sequence: event → vendor → config(config select, event_items OR insert) →
  //   categories → default_items → event_items → discounts →
  //   modifierGroups(allGroups, filteredGroups, modifiers) → tags
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /vendor/:vendorId/menu/events/:eventId', () => {
    it('returns 200 with complete event menu (event, vendor, config, categories, items, modifierGroups, tags)', async () => {
      const event = { id: 'event-1', name: 'Test Event', start_date: '2026-03-01T08:00:00Z', end_date: '2026-03-01T20:00:00Z' };
      const vendor = { id: 'vendor-1', name: 'Test Vendor' };
      const config = makeDbEventMenuConfig();
      const configEventItems = [makeEventMenuItem({ default_menu_item_id: 'item-1' })];
      const categories = [makeDbMenuCategory({ id: 'cat-1' })];
      const defaultItems = [makeDefaultMenuItem({ id: 'item-1', category_id: 'cat-1' })];
      const eventItems = [makeEventMenuItem({ default_menu_item_id: 'item-1', is_included: true })];
      const allGroups = [makeDbModifierGroup()];
      const filteredGroups = [makeDbModifierGroup()];
      const modifiers: any[] = [];
      const tags: any[] = [];

      // getEventMenu sequence:
      // 1. events (single)
      // 2. vendors (single)
      // 3. event_menu_configurations (single) — getOrCreateEventMenuConfig
      // 4. event_menu_items — for config reconstruction
      // 5. menu_categories
      // 6. default_menu_items
      // 7. event_menu_items
      // 8. modifier_groups (all - debug)
      // 9. modifier_groups (filtered)
      // 10. modifiers
      // 11. menu_tags
      mockFromSequence([
        createSupabaseMock({ data: event, error: null }),            // 1. event
        createSupabaseMock({ data: vendor, error: null }),           // 2. vendor
        createSupabaseMock({ data: config, error: null }),           // 3. config
        createSupabaseMock({ data: configEventItems, error: null }), // 4. event items for config
        createSupabaseMock({ data: categories, error: null }),       // 5. categories
        createSupabaseMock({ data: defaultItems, error: null }),     // 6. default items
        createSupabaseMock({ data: eventItems, error: null }),       // 7. event items
        createSupabaseMock({ data: allGroups, error: null }),        // 8. modifier groups (all)
        createSupabaseMock({ data: filteredGroups, error: null }),   // 9. modifier groups (filtered)
        createSupabaseMock({ data: modifiers, error: null }),        // 10. modifiers
        createSupabaseMock({ data: tags, error: null }),             // 11. tags
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/event-1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('event');
      expect(body.event.id).toBe('event-1');
      expect(body).toHaveProperty('vendor');
      expect(body.vendor.id).toBe('vendor-1');
      expect(body).toHaveProperty('configuration');
      expect(body).toHaveProperty('categories');
      expect(body).toHaveProperty('menuItems');
      expect(body).toHaveProperty('modifierGroups');
      expect(body).toHaveProperty('tags');
    });

    it('returns cached event menu when cache hit', async () => {
      const cachedMenu = {
        event: { id: 'event-1', name: 'Cached Event', startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-01T23:59:59Z' },
        vendor: { id: 'vendor-1', name: 'Cached Vendor' },
        configuration: {},
        categories: [],
        menuItems: [],
        modifierGroups: [],
        tags: [],
      };
      cacheMock.get.mockResolvedValue(cachedMenu);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/event-1',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().event.name).toBe('Cached Event');
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('creates default config when none exists', async () => {
      const event = { id: 'event-1', name: 'Test Event', start_date: '2026-03-01T08:00:00Z', end_date: '2026-03-01T20:00:00Z' };
      const vendor = { id: 'vendor-1', name: 'Test Vendor' };
      const newConfig = makeDbEventMenuConfig({ status: 'DRAFT' });

      // Config doesn't exist (single returns error PGRST116), so it creates a new one
      mockFromSequence([
        createSupabaseMock({ data: event, error: null }),          // 1. event
        createSupabaseMock({ data: vendor, error: null }),         // 2. vendor
        createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'No rows' } }), // 3. config not found
        createSupabaseMock({ data: newConfig, error: null }),      // 4. insert config
        createSupabaseMock({ data: [], error: null }),             // 5. categories
        createSupabaseMock({ data: [], error: null }),             // 6. default items
        createSupabaseMock({ data: [], error: null }),             // 7. event items
        createSupabaseMock({ data: [], error: null }),             // 8. modifier groups (all)
        createSupabaseMock({ data: [], error: null }),             // 9. modifier groups (filtered)
        createSupabaseMock({ data: [], error: null }),             // 10. modifiers
        createSupabaseMock({ data: [], error: null }),             // 11. tags
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/event-1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('configuration');
    });

    it('excludes items with isIncluded=false', async () => {
      const event = { id: 'event-1', name: 'Test Event', start_date: '2026-03-01T08:00:00Z', end_date: '2026-03-01T20:00:00Z' };
      const vendor = { id: 'vendor-1', name: 'Test Vendor' };
      const config = makeDbEventMenuConfig();
      const item1Id = 'item-included';
      const item2Id = 'item-excluded';
      const defaultItems = [
        makeDefaultMenuItem({ id: item1Id, name: 'Included Item' }),
        makeDefaultMenuItem({ id: item2Id, name: 'Excluded Item' }),
      ];
      const eventItems = [
        makeEventMenuItem({ default_menu_item_id: item1Id, is_included: true }),
        makeEventMenuItem({ default_menu_item_id: item2Id, is_included: false }),
      ];

      mockFromSequence([
        createSupabaseMock({ data: event, error: null }),
        createSupabaseMock({ data: vendor, error: null }),
        createSupabaseMock({ data: config, error: null }),
        createSupabaseMock({ data: eventItems, error: null }),
        createSupabaseMock({ data: [], error: null }),          // categories
        createSupabaseMock({ data: defaultItems, error: null }),
        createSupabaseMock({ data: eventItems, error: null }),
        createSupabaseMock({ data: [], error: null }),
        createSupabaseMock({ data: [], error: null }),
        createSupabaseMock({ data: [], error: null }),
        createSupabaseMock({ data: [], error: null }),
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/event-1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Only the included item should be in the response
      const itemNames = body.menuItems.map((i: any) => i.name);
      expect(itemNames).toContain('Included Item');
      expect(itemNames).not.toContain('Excluded Item');
    });

    it('returns 500 when event or vendor is not found', async () => {
      // event query returns null data
      mockFromSequence([
        createSupabaseMock({ data: null, error: null }),  // event (null)
        createSupabaseMock({ data: null, error: null }),  // vendor (null)
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/nonexistent',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // POST /vendor/:vendorId/menu/default/items/bulk — bulkCreateDefaultMenuItems
  // DB sequence: validate items → insert → cache invalidation
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST /vendor/:vendorId/menu/default/items/bulk', () => {
    it('returns 201 with { menuItems, count } on successful bulk create', async () => {
      const createdItems = [
        makeDefaultMenuItem({ id: 'new-1', name: 'Pizza' }),
        makeDefaultMenuItem({ id: 'new-2', name: 'Pasta' }),
      ];

      // bulkCreateDefaultMenuItems: 1 from() call for the insert
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: createdItems, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/default/items/bulk',
        payload: {
          items: [
            { name: 'Pizza', basePrice: 120, type: 'FOOD', categoryId: 'cat-1' },
            { name: 'Pasta', basePrice: 90, type: 'FOOD', categoryId: 'cat-1' },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('menuItems');
      expect(body).toHaveProperty('count');
      expect(body.count).toBe(2);
    });

    it('returns 400 when item schema validation fails (missing required fields)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/default/items/bulk',
        payload: {
          items: [
            { name: 'Test', basePrice: 100, type: 'FOOD' }, // missing required 'categoryId'
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('categoryId');
    });

    it('returns 400 when items array is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/default/items/bulk',
        payload: {
          items: [], // minItems: 1
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 500 when DB insert fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Bulk insert failed' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/default/items/bulk',
        payload: {
          items: [
            { name: 'Good Item', basePrice: 100, type: 'FOOD', categoryId: 'cat-1' },
          ],
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // POST /vendor/:vendorId/menu/events/:eventId/price-adjustment — bulkPriceAdjustment
  // DB sequence: fetch default items → loop upsert per item → broadcast → cache
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST /vendor/:vendorId/menu/events/:eventId/price-adjustment', () => {
    it('returns 200 with { updatedCount } for percentage adjustment', async () => {
      const items = [
        { id: 'item-1', base_price: 100, name: 'Burger' },
        { id: 'item-2', base_price: 200, name: 'Steak' },
      ];

      // Sequence: 1 fetch + 2 upserts
      mockFromSequence([
        createSupabaseMock({ data: items, error: null }),    // fetch default items
        createSupabaseMock({ data: null, error: null }),     // upsert item-1
        createSupabaseMock({ data: null, error: null }),     // upsert item-2
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/price-adjustment',
        payload: {
          adjustment: { type: 'PERCENTAGE', value: 10, direction: 'INCREASE' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('updatedCount');
      expect(body.updatedCount).toBe(2);
    });

    it('returns 200 with { updatedCount } for fixed adjustment', async () => {
      const items = [
        { id: 'item-1', base_price: 100, name: 'Fries' },
      ];

      mockFromSequence([
        createSupabaseMock({ data: items, error: null }),
        createSupabaseMock({ data: null, error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/price-adjustment',
        payload: {
          adjustment: { type: 'FIXED', value: 25, direction: 'INCREASE' },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().updatedCount).toBe(1);
    });

    it('returns { updatedCount: 0 } when no items match', async () => {
      mockFromSequence([
        createSupabaseMock({ data: [], error: null }), // no items found
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/price-adjustment',
        payload: {
          adjustment: { type: 'PERCENTAGE', value: 10, direction: 'INCREASE' },
          categoryIds: ['nonexistent-category'],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().updatedCount).toBe(0);
    });

    it('filters by categoryIds when provided', async () => {
      const items = [
        { id: 'item-1', base_price: 100, name: 'Burger' },
      ];

      mockFromSequence([
        createSupabaseMock({ data: items, error: null }),
        createSupabaseMock({ data: null, error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/price-adjustment',
        payload: {
          adjustment: { type: 'FIXED', value: 5, direction: 'INCREASE' },
          categoryIds: ['cat-1'],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().updatedCount).toBe(1);
    });

    it('filters by itemIds when provided', async () => {
      const items = [
        { id: 'specific-item', base_price: 150, name: 'Special' },
      ];

      mockFromSequence([
        createSupabaseMock({ data: items, error: null }),
        createSupabaseMock({ data: null, error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/price-adjustment',
        payload: {
          adjustment: { type: 'PERCENTAGE', value: 15, direction: 'DECREASE' },
          itemIds: ['specific-item'],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().updatedCount).toBe(1);
    });

    it('returns 400 when adjustment schema is invalid (missing direction)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/price-adjustment',
        payload: {
          adjustment: { type: 'FIXED', value: 10 }, // missing required 'direction'
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 500 when DB throws', async () => {
      supabaseMock.from.mockImplementation(() => {
        throw new Error('Connection refused');
      });

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/price-adjustment',
        payload: {
          adjustment: { type: 'FIXED', value: 10, direction: 'INCREASE' },
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // POST /vendor/:vendorId/menu/events/:eventId/clone — cloneEventMenu
  // DB sequence: fetch source items → (fetch existing OR loop upsert) → cache
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST /vendor/:vendorId/menu/events/:eventId/clone', () => {
    it('returns 200 with { clonedCount } when includeOverrides=false (insert new only)', async () => {
      const sourceItems = [
        makeEventMenuItem({ default_menu_item_id: 'dmi-1' }),
        makeEventMenuItem({ default_menu_item_id: 'dmi-2' }),
      ];
      const existingTargetItems = [{ default_menu_item_id: 'dmi-1' }]; // dmi-1 already exists in target
      const insertedItems = [makeEventMenuItem({ default_menu_item_id: 'dmi-2', event_id: 'target-event' })];

      // Sequence: fetch source → fetch existing target → insert new
      mockFromSequence([
        createSupabaseMock({ data: sourceItems, error: null }),        // fetch source
        createSupabaseMock({ data: existingTargetItems, error: null }),// fetch existing in target
        createSupabaseMock({ data: insertedItems, error: null }),     // insert new items
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/target-event/clone',
        payload: {
          sourceEventId: 'source-event',
          includeOverrides: false,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('clonedCount');
      expect(body.clonedCount).toBe(1); // only dmi-2 was new
    });

    it('returns 200 with { clonedCount } when includeOverrides=true (upsert all)', async () => {
      const sourceItems = [
        makeEventMenuItem({ default_menu_item_id: 'dmi-1' }),
        makeEventMenuItem({ default_menu_item_id: 'dmi-2' }),
      ];

      // Sequence: fetch source → batch upsert all items
      mockFromSequence([
        createSupabaseMock({ data: sourceItems, error: null }),
        createSupabaseMock({ data: sourceItems, error: null }), // batch upsert returns upserted items
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/target-event/clone',
        payload: {
          sourceEventId: 'source-event',
          includeOverrides: true,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().clonedCount).toBe(2);
    });

    it('returns { clonedCount: 0 } when source event has no items', async () => {
      mockFromSequence([
        createSupabaseMock({ data: [], error: null }), // empty source
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/target-event/clone',
        payload: {
          sourceEventId: 'empty-source',
          includeOverrides: false,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().clonedCount).toBe(0);
    });

    it('returns { clonedCount: 0 } when all source items already exist in target (no overrides)', async () => {
      const sourceItems = [
        makeEventMenuItem({ default_menu_item_id: 'dmi-1' }),
      ];

      mockFromSequence([
        createSupabaseMock({ data: sourceItems, error: null }),
        createSupabaseMock({ data: [{ default_menu_item_id: 'dmi-1' }], error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/target-event/clone',
        payload: {
          sourceEventId: 'source-event',
          includeOverrides: false,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().clonedCount).toBe(0);
    });

    it('returns 500 when DB throws during clone', async () => {
      supabaseMock.from.mockImplementation(() => {
        throw new Error('DB error during clone');
      });

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/target-event/clone',
        payload: {
          sourceEventId: 'source-event',
          includeOverrides: true,
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GET /vendor/:vendorId/menu/events/:eventId/config — getOrCreateEventMenuConfig
  // DB sequence: select config → (select event items OR insert default config)
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /vendor/:vendorId/menu/events/:eventId/config', () => {
    it('returns 200 with { configuration } when config exists', async () => {
      const config = makeDbEventMenuConfig({ status: 'PUBLISHED' });
      const eventItems = [makeEventMenuItem()];

      // getOrCreateEventMenuConfig: 1) select config (found), 2) select event items
      mockFromSequence([
        createSupabaseMock({ data: config, error: null }),
        createSupabaseMock({ data: eventItems, error: null }),
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/event-1/config',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('configuration');
      expect(body.configuration.status).toBe('PUBLISHED');
    });

    it('returns 200 with newly created default config when none exists', async () => {
      const newConfig = makeDbEventMenuConfig({ status: 'DRAFT' });

      // 1) select config (not found - returns null data), 2) insert default
      mockFromSequence([
        createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'No rows' } }),
        createSupabaseMock({ data: newConfig, error: null }),
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/event-1/config',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('configuration');
      expect(body.configuration.status).toBe('DRAFT');
    });

    it('returns 500 when config creation fails', async () => {
      mockFromSequence([
        createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'No rows' } }),
        createSupabaseMock({ data: null, error: { message: 'Insert failed' } }),
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/event-1/config',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PUT /vendor/:vendorId/menu/events/:eventId/config — updateEventMenuConfig
  // DB sequence: update config → fetch event items → cache invalidation
  // ══════════════════════════════════════════════════════════════════════════

  describe('PUT /vendor/:vendorId/menu/events/:eventId/config', () => {
    it('returns 200 with { configuration } on successful update', async () => {
      const updatedConfig = makeDbEventMenuConfig({
        is_accepting_orders: false,
        max_concurrent_orders: 20,
        minimum_order_value: 50,
      });
      const eventItems = [makeEventMenuItem()];

      // updateEventMenuConfig: 1) update config, 2) fetch event items for reconstruction
      mockFromSequence([
        createSupabaseMock({ data: updatedConfig, error: null }),
        createSupabaseMock({ data: eventItems, error: null }),
      ]);

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/events/event-1/config',
        payload: {
          isAcceptingOrders: false,
          maxConcurrentOrders: 20,
          minimumOrderValue: 50,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('configuration');
      expect(body.configuration.isAcceptingOrders).toBe(false);
    });

    it('returns 500 when config update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Update failed' } }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/events/event-1/config',
        payload: { isAcceptingOrders: true },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // POST /vendor/:vendorId/menu/events/:eventId/publish — publishEventMenu
  // Same as updateEventMenuConfig with { status: 'PUBLISHED' }
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST /vendor/:vendorId/menu/events/:eventId/publish', () => {
    it('returns 200 with { configuration } with status PUBLISHED', async () => {
      const publishedConfig = makeDbEventMenuConfig({
        status: 'PUBLISHED',
        published_at: new Date().toISOString(),
      });
      const eventItems = [makeEventMenuItem()];

      // publishEventMenu → updateEventMenuConfig: 1) update, 2) fetch event items
      mockFromSequence([
        createSupabaseMock({ data: publishedConfig, error: null }),
        createSupabaseMock({ data: eventItems, error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/publish',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('configuration');
      expect(body.configuration.status).toBe('PUBLISHED');
    });

    it('returns 500 when publish fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Publish failed' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/publish',
        payload: {},
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
