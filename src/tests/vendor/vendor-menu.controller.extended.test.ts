import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { cacheMock, redisMock } from '../mocks/redis.js';
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

vi.mock('../../websocket/index.js', () => ({
  broadcastPriceUpdate: vi.fn(),
  broadcastAvailabilityUpdate: vi.fn(),
}));

vi.mock('../../lib/feature-flags.js', () => ({
  requireFeature: () => async () => {},
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

const makeDbModifier = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  group_id: 'group-1',
  name: 'Extra Cheese',
  price_adjustment: 15,
  is_default: false,
  is_available: true,
  display_order: 0,
  nutritional_info: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const makeDbTemplate = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  vendor_id: 'vendor-1',
  name: 'Weekend Menu',
  description: 'Template for weekend events',
  template_data: { items: [], priceAdjustment: null },
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

describe('VendorMenuController — Extended Coverage', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp(async (fastify) => {
      await fastify.register(vendorMenuController, { prefix: '/vendor' });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /vendor/:vendorId/menu/default/items/:itemId ──────────────────────

  describe('GET /vendor/:vendorId/menu/default/items/:itemId', () => {
    it('returns 200 with { menuItem } when found', async () => {
      const itemId = 'item-found';
      const dbItem = makeDefaultMenuItem({ id: itemId, name: 'Chicken Wrap' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/vendor/vendor-1/menu/default/items/${itemId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('menuItem');
      expect(body.menuItem.name).toBe('Chicken Wrap');
    });

    it('returns 404 when menu item is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'No rows found' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/default/items/nonexistent-item',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Menu item not found' });
    });
  });

  // ── GET /vendor/:vendorId/menu/events/:eventId/items/:eventMenuItemId ─────

  describe('GET /vendor/:vendorId/menu/events/:eventId/items/:eventMenuItemId', () => {
    it('returns 200 with { eventMenuItem } when found', async () => {
      const eventItemId = 'emi-1';
      const defaultItemId = crypto.randomUUID();
      // This is a single join query returning event_menu_item with nested default_menu_items
      const dbJoinedResult = {
        ...makeEventMenuItem({ id: eventItemId, default_menu_item_id: defaultItemId }),
        default_menu_items: {
          ...makeDefaultMenuItem({ id: defaultItemId }),
          menu_categories: makeDbMenuCategory(),
        },
      };

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbJoinedResult, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/vendor/vendor-1/menu/events/event-1/items/${eventItemId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('eventMenuItem');
    });

    it('returns 404 when the event menu item is not found', async () => {
      // getEventMenuItem uses assertExists which throws NotFoundError when data is null
      // handleDatabaseError is called when there's an error from supabase
      // With null data and no error, assertExists triggers NotFoundError
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/events/event-1/items/nonexistent',
      });

      // assertExists throws NotFoundError which has message containing 'not found'
      // Controller catches and returns 404 for messages containing 'not found'
      expect(res.statusCode).toBe(404);
    });
  });

  // ── PUT /vendor/:vendorId/menu/events/:eventId/items/:eventItemId ─────────

  describe('PUT /vendor/:vendorId/menu/events/:eventId/items/:eventItemId', () => {
    it('returns 200 with { eventMenuItem } on successful update', async () => {
      const dbItem = makeEventMenuItem({ id: 'emi-update', price_override: 150 });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/events/event-1/items/emi-update',
        payload: { priceOverride: 150, isIncluded: true },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('eventMenuItem');
    });

    it('returns 500 when the update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Update failed' } }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/events/event-1/items/emi-bad',
        payload: { priceOverride: 200 },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/events/:eventId/items/bulk ────────────────

  describe('POST /vendor/:vendorId/menu/events/:eventId/items/bulk', () => {
    it('returns 200 with { eventMenuItems, count } on successful bulk update', async () => {
      const dbItem1 = makeEventMenuItem({ id: 'emi-1' });
      const dbItem2 = makeEventMenuItem({ id: 'emi-2' });

      // bulkUpdateEventMenuItems loops over updates, each doing a separate from() call
      // then invalidateEventMenuCaches does cache.del
      mockFromSequence([
        createSupabaseMock({ data: dbItem1, error: null }),
        createSupabaseMock({ data: dbItem2, error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/items/bulk',
        payload: {
          updates: [
            { menuItemId: 'item-1', changes: { isIncluded: true } },
            { menuItemId: 'item-2', changes: { isIncluded: false } },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('eventMenuItems');
      expect(body).toHaveProperty('count');
    });

    it('returns 500 when bulk update fails', async () => {
      supabaseMock.from.mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/items/bulk',
        payload: {
          updates: [{ menuItemId: 'item-1', changes: { isIncluded: true } }],
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/events/:eventId/reset-prices ──────────────

  describe('POST /vendor/:vendorId/menu/events/:eventId/reset-prices', () => {
    it('returns 200 with { resetCount } on success', async () => {
      // resetEventMenuPrices makes 3 from() calls:
      // 1. fetch current items (event_menu_items select with join)
      // 2. update items (event_menu_items update, returns ids)
      // 3. update config (event_menu_configurations update)
      const currentItems = [makeEventMenuItem(), makeEventMenuItem()];
      const fetchCurrentMock = createSupabaseMock({ data: currentItems, error: null });
      const updateItemsMock = createSupabaseMock({ data: [{ id: 'a' }, { id: 'b' }], error: null });
      const updateConfigMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([fetchCurrentMock, updateItemsMock, updateConfigMock]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/events/event-1/reset-prices',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('resetCount');
    });
  });

  // ── GET /vendor/:vendorId/menu/templates ──────────────────────────────────

  describe('GET /vendor/:vendorId/menu/templates', () => {
    it('returns 200 with { templates } array', async () => {
      const dbTemplates = [makeDbTemplate({ name: 'Weekday Menu' }), makeDbTemplate({ name: 'Weekend Menu' })];

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbTemplates, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/templates',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('templates');
      expect(body.templates).toHaveLength(2);
    });

    it('returns 200 with empty templates array', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/templates',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().templates).toHaveLength(0);
    });

    it('returns 500 when supabase.from throws an exception', async () => {
      // getVendorTemplates uses (data || []).map(), so null data returns []
      // To trigger a 500, make from() itself throw
      supabaseMock.from.mockImplementation(() => {
        throw new Error('Connection lost');
      });

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/templates',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/templates ─────────────────────────────────

  describe('POST /vendor/:vendorId/menu/templates', () => {
    it('returns 201 with { template } on successful creation', async () => {
      const dbTemplate = makeDbTemplate({
        name: 'New Template',
        template_type: 'CUSTOM',
        is_default: false,
        is_active: true,
        usage_count: 0,
        included_category_ids: [],
        included_item_ids: [],
        excluded_item_ids: [],
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbTemplate, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/templates',
        payload: {
          name: 'New Template',
          templateType: 'CUSTOM',
          description: 'A new menu template',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('template');
      expect(body.template.name).toBe('New Template');
    });

    it('returns 500 when template creation fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Insert failed' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/templates',
        payload: { name: 'Bad Template', templateType: 'CUSTOM' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PUT /vendor/:vendorId/menu/templates/:templateId ──────────────────────

  describe('PUT /vendor/:vendorId/menu/templates/:templateId', () => {
    it('returns 200 with { template } on successful update', async () => {
      const dbTemplate = makeDbTemplate({ id: 'tmpl-1', name: 'Updated Template' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbTemplate, error: null }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/templates/tmpl-1',
        payload: { name: 'Updated Template' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('template');
      expect(body.template.name).toBe('Updated Template');
    });

    it('returns 500 when template update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Not found' } }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/templates/nonexistent',
        payload: { name: 'Ghost' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── DELETE /vendor/:vendorId/menu/templates/:templateId ───────────────────

  describe('DELETE /vendor/:vendorId/menu/templates/:templateId', () => {
    it('returns 204 on successful deletion', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/templates/tmpl-to-delete',
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 500 when deletion fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Delete error' } }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/templates/locked-tmpl',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/templates/:templateId/apply ───────────────

  describe('POST /vendor/:vendorId/menu/templates/:templateId/apply', () => {
    it('returns 200 with applied template result', async () => {
      const dbTemplate = makeDbTemplate({ id: 'tmpl-apply' });
      const templateMock = createSupabaseMock({ data: dbTemplate, error: null });
      const upsertMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([templateMock, upsertMock]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/templates/tmpl-apply/apply',
        payload: { eventId: 'event-1', overrideExisting: false },
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 500 when template application fails', async () => {
      supabaseMock.from.mockImplementation(() => {
        throw new Error('Template not found');
      });

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/templates/bad-tmpl/apply',
        payload: { eventId: 'event-1', overrideExisting: false },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PUT /vendor/:vendorId/menu/categories/:categoryId ─────────────────────

  describe('PUT /vendor/:vendorId/menu/categories/:categoryId', () => {
    it('returns 200 with { category } on successful update', async () => {
      const dbCategory = makeDbMenuCategory({ id: 'cat-upd', name: 'Updated Mains' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbCategory, error: null }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/categories/cat-upd',
        payload: { name: 'Updated Mains' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('category');
      expect(body.category.name).toBe('Updated Mains');
    });

    it('returns 500 when category update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Update failed' } }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/categories/bad-cat',
        payload: { name: 'Ghost' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── DELETE /vendor/:vendorId/menu/categories/:categoryId ──────────────────

  describe('DELETE /vendor/:vendorId/menu/categories/:categoryId', () => {
    it('returns 204 on successful deletion', async () => {
      // Check for items in category
      const itemsMock = createSupabaseMock({ data: [], error: null });
      const deleteMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([itemsMock, deleteMock]);

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/categories/cat-to-delete',
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 400 when category has items and cannot be deleted', async () => {
      // deleteCategory first checks for items in the category
      // If items exist, it throws Error('Cannot delete category with existing menu items')
      // The controller catches errors with 'Cannot delete' in the message and returns 400
      const itemsMock = createSupabaseMock({ data: [{ id: 'item-1' }], error: null });

      supabaseMock.from.mockReturnValue(itemsMock);

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/categories/cat-with-items',
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── PUT /vendor/:vendorId/menu/categories/reorder ─────────────────────────

  describe('PUT /vendor/:vendorId/menu/categories/reorder', () => {
    it('returns 200 with { success: true } on successful reorder', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/categories/reorder',
        payload: {
          orders: [
            { id: 'cat-1', displayOrder: 0 },
            { id: 'cat-2', displayOrder: 1 },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true });
    });

    it('returns 500 when reorder fails', async () => {
      supabaseMock.from.mockImplementation(() => {
        throw new Error('Reorder DB error');
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/categories/reorder',
        payload: {
          orders: [{ id: 'cat-1', displayOrder: 0 }],
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PUT /vendor/:vendorId/menu/modifier-groups/:groupId ───────────────────

  describe('PUT /vendor/:vendorId/menu/modifier-groups/:groupId', () => {
    it('returns 200 with { modifierGroup } on successful update', async () => {
      const dbGroup = makeDbModifierGroup({ id: 'grp-upd', name: 'Updated Size' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbGroup, error: null }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/modifier-groups/grp-upd',
        payload: { name: 'Updated Size' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('modifierGroup');
      expect(body.modifierGroup.name).toBe('Updated Size');
    });

    it('returns 404 when modifier group is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Modifier group not found' } }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/modifier-groups/nonexistent',
        payload: { name: 'Ghost' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /vendor/:vendorId/menu/modifier-groups/:groupId ────────────────

  describe('DELETE /vendor/:vendorId/menu/modifier-groups/:groupId', () => {
    it('returns 204 on successful deletion', async () => {
      // Check for linked items
      const linkedMock = createSupabaseMock({ data: [], error: null });
      const deleteMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([linkedMock, deleteMock]);

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/modifier-groups/grp-to-delete',
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 400 when modifier group has existing modifiers and cannot be deleted', async () => {
      // deleteModifierGroup first checks for modifiers in the group
      // If modifiers exist, throws Error('Cannot delete modifier group with existing modifiers')
      // Controller catches 'Cannot delete' and returns 400
      const modifiersMock = createSupabaseMock({ data: [{ id: 'mod-1' }], error: null });

      supabaseMock.from.mockReturnValue(modifiersMock);

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/modifier-groups/linked-group',
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /vendor/:vendorId/menu/modifier-groups/:groupId/modifiers ────────

  describe('POST /vendor/:vendorId/menu/modifier-groups/:groupId/modifiers', () => {
    it('returns 201 with { modifier } on successful creation', async () => {
      const dbModifier = makeDbModifier({ name: 'Extra Sauce', price_adjustment: 10 });

      // addModifier: 1) check group exists, 2) insert modifier
      const groupCheckMock = createSupabaseMock({ data: { id: 'grp-1' }, error: null });
      const insertMock = createSupabaseMock({ data: dbModifier, error: null });

      mockFromSequence([groupCheckMock, insertMock]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/modifier-groups/grp-1/modifiers',
        payload: {
          name: 'Extra Sauce',
          priceAdjustment: 10,
          isDefault: false,
          isAvailable: true,
          displayOrder: 0,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('modifier');
    });

    it('returns 500 when modifier creation fails', async () => {
      // Group exists but insert fails
      const groupCheckMock = createSupabaseMock({ data: { id: 'grp-1' }, error: null });
      const insertMock = createSupabaseMock({ data: null, error: { message: 'Insert failed' } });

      mockFromSequence([groupCheckMock, insertMock]);

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/modifier-groups/grp-1/modifiers',
        payload: {
          name: 'Bad Modifier',
          priceAdjustment: 5,
          isDefault: false,
          isAvailable: true,
          displayOrder: 0,
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PUT /vendor/:vendorId/menu/modifier-groups/:groupId/modifiers/:modifierId

  describe('PUT /vendor/:vendorId/menu/modifier-groups/:groupId/modifiers/:modifierId', () => {
    it('returns 200 with { modifier } on successful update', async () => {
      const dbModifier = makeDbModifier({ id: 'mod-upd', name: 'Updated Modifier' });

      // updateModifier: 1) check group exists, 2) update modifier
      const groupCheckMock = createSupabaseMock({ data: { id: 'grp-1' }, error: null });
      const updateMock = createSupabaseMock({ data: dbModifier, error: null });

      mockFromSequence([groupCheckMock, updateMock]);

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/modifier-groups/grp-1/modifiers/mod-upd',
        payload: { name: 'Updated Modifier', priceAdjustment: 20 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('modifier');
    });

    it('returns 404 when the modifier group is not found', async () => {
      // updateModifier first checks group; null group throws 'not found'
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/vendor/vendor-1/menu/modifier-groups/grp-1/modifiers/nonexistent',
        payload: { name: 'Ghost' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /vendor/:vendorId/menu/modifier-groups/:groupId/modifiers/:modifierId

  describe('DELETE /vendor/:vendorId/menu/modifier-groups/:groupId/modifiers/:modifierId', () => {
    it('returns 204 on successful deletion', async () => {
      // deleteModifier: 1) check group exists, 2) delete modifier
      const groupCheckMock = createSupabaseMock({ data: { id: 'grp-1' }, error: null });
      const deleteMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([groupCheckMock, deleteMock]);

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/modifier-groups/grp-1/modifiers/mod-to-delete',
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 404 when the modifier group is not found', async () => {
      // deleteModifier first checks group, if group is null it throws 'not found'
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/vendor/vendor-1/menu/modifier-groups/grp-1/modifiers/ghost-mod',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /vendor/:vendorId/menu/tags ───────────────────────────────────────

  describe('GET /vendor/:vendorId/menu/tags', () => {
    it('returns 200 with { tags } array', async () => {
      const dbTags = [makeDbTag({ name: 'Spicy' }), makeDbTag({ name: 'Vegetarian' })];

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbTags, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/tags',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('tags');
      expect(body.tags).toHaveLength(2);
    });

    it('returns 200 with empty tags array', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/tags',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().tags).toHaveLength(0);
    });

    it('returns 500 when supabase.from throws an exception', async () => {
      // getAllTags uses (data || []).map(), so null data returns [].
      // To trigger a 500, make from() itself throw
      supabaseMock.from.mockImplementation(() => {
        throw new Error('Connection lost');
      });

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/tags',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/tags ──────────────────────────────────────

  describe('POST /vendor/:vendorId/menu/tags', () => {
    it('returns 201 with { tag } on successful creation', async () => {
      const dbTag = makeDbTag({ name: 'Gluten Free', slug: 'gluten-free', is_active: true });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbTag, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/tags',
        payload: { name: 'Gluten Free', category: 'DIETARY', color: '#00FF00' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('tag');
    });

    it('returns 500 when tag creation fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Duplicate tag' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/tags',
        payload: { name: 'Duplicate', category: 'CUSTOM', color: '#000000' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /vendor/:vendorId/menu/analytics ──────────────────────────────────

  describe('GET /vendor/:vendorId/menu/analytics', () => {
    it('returns 200 with analytics data from orders', async () => {
      // getMenuAnalytics queries orders table and processes in-memory
      const orders = [
        {
          id: 'order-1',
          vendor_id: 'vendor-1',
          items: [{ id: 'item-1', price: 100, quantity: 2 }],
        },
      ];

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: orders, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/analytics',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('summary');
      expect(body).toHaveProperty('itemAnalytics');
    });

    it('returns 200 with analytics filtered by eventId', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/analytics?eventId=event-123',
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 200 with analytics filtered by date range', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/analytics?startDate=2026-01-01T00:00:00Z&endDate=2026-12-31T23:59:59Z',
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 500 when supabase.from throws an exception', async () => {
      // getMenuAnalytics uses (orders || []) so null data returns empty analytics.
      // To trigger a 500, make from() throw
      supabaseMock.from.mockImplementation(() => {
        throw new Error('Connection lost');
      });

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/analytics',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /vendor/:vendorId/menu/invalidate-cache ──────────────────────────

  describe('POST /vendor/:vendorId/menu/invalidate-cache', () => {
    it('returns 200 with { success: true } on successful invalidation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/invalidate-cache',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true });
    });

    it('returns 200 with { success: true } when eventId is specified', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/vendor/vendor-1/menu/invalidate-cache',
        payload: { eventId: 'event-123' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true });
    });
  });

  // ── GET /vendor/:vendorId/menu/templates/:templateId ──────────────────────

  describe('GET /vendor/:vendorId/menu/templates/:templateId', () => {
    it('returns 200 with template and preview', async () => {
      const dbTemplate = makeDbTemplate({
        id: 'tmpl-get',
        name: 'Get Template',
        template_type: 'CUSTOM',
        included_category_ids: [],
        included_item_ids: [],
        excluded_item_ids: [],
        is_default: false,
        is_active: true,
        usage_count: 0,
      });
      const dbItems = [makeDefaultMenuItem()];

      // getTemplate makes 2 from() calls: 1) template, 2) items query
      mockFromSequence([
        createSupabaseMock({ data: dbTemplate, error: null }),
        createSupabaseMock({ data: dbItems, error: null }),
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/templates/tmpl-get',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('template');
      expect(body).toHaveProperty('previewItems');
      expect(body).toHaveProperty('estimatedItemCount');
    });

    it('returns 500 when template is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Not found' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/vendor/vendor-1/menu/templates/nonexistent',
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
