import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { cacheMock, redisMock } from '../mocks/redis.js';
import { makeVendor, makeEventMenuConfig } from '../fixtures/index.js';

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

vi.mock('../../discount/discount.service.js', () => ({
  DiscountService: vi.fn(function() {
    return {
      resolveDiscountsForMenu: vi.fn().mockResolvedValue(new Map()),
    };
  }),
}));

// Import after mocks
import { VendorMenuService } from '../../vendor/menu/vendor-menu.service.js';

// ── Fixture factories for vendor-menu module ──────────────────────────────────

const makeDefaultMenuItem = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  vendor_id: crypto.randomUUID(),
  category_id: crypto.randomUUID(),
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
  event_id: crypto.randomUUID(),
  vendor_id: crypto.randomUUID(),
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
  event_id: crypto.randomUUID(),
  vendor_id: crypto.randomUUID(),
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
  vendor_id: crypto.randomUUID(),
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
  vendor_id: crypto.randomUUID(),
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
  group_id: crypto.randomUUID(),
  name: 'Small',
  description: null,
  price_adjustment: 0,
  is_default: false,
  is_available: true,
  display_order: 0,
  nutritional_info: null,
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

describe('VendorMenuService', () => {
  let service: VendorMenuService;

  beforeEach(() => {
    vi.resetAllMocks();
    // Restore default cache behaviour: cache miss unless overridden per test
    cacheMock.get.mockResolvedValue(null);
    cacheMock.set.mockResolvedValue(undefined);
    cacheMock.del.mockResolvedValue(undefined);
    service = new VendorMenuService();
  });

  // ── getDefaultMenu ────────────────────────────────────────────────────────────

  describe('getDefaultMenu', () => {
    it('returns cached response when cache hits', async () => {
      const cachedMenu = {
        vendor: { id: 'v1', name: 'Test Vendor' },
        categories: [],
        menuItems: [],
        modifierGroups: [],
        tags: [],
      };
      cacheMock.get.mockResolvedValueOnce(cachedMenu);

      const result = await service.getDefaultMenu('v1');

      expect(result).toEqual(cachedMenu);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('fetches and returns menu with items grouped by category on cache miss', async () => {
      const vendorId = 'vendor-1';
      const categoryId = 'cat-1';
      const dbVendor = { id: vendorId, name: 'Test Vendor' };
      const dbCategory = makeDbMenuCategory({ id: categoryId, vendor_id: vendorId });
      const dbItem = makeDefaultMenuItem({ id: 'item-1', vendor_id: vendorId, category_id: categoryId });

      cacheMock.get.mockResolvedValueOnce(null);

      const vendorMock = createSupabaseMock({ data: dbVendor, error: null });
      const categoriesMock = createSupabaseMock({ data: [dbCategory], error: null });
      const itemsMock = createSupabaseMock({ data: [dbItem], error: null });
      // modifier_groups (from getVendorModifierGroups: ALL groups query + filtered query)
      const allGroupsMock = createSupabaseMock({ data: [], error: null });
      const filteredGroupsMock = createSupabaseMock({ data: [], error: null });
      // modifiers (empty since no groups)
      const modifiersMock = createSupabaseMock({ data: [], error: null });
      // tags
      const tagsMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([
        vendorMock,
        categoriesMock,
        itemsMock,
        allGroupsMock,
        filteredGroupsMock,
        modifiersMock,
        tagsMock,
      ]);

      const result = await service.getDefaultMenu(vendorId);

      expect(result.vendor.id).toBe(vendorId);
      expect(result.menuItems).toHaveLength(1);
      expect(result.categories).toHaveLength(1);
      expect(cacheMock.set).toHaveBeenCalledWith(
        `menu:default:${vendorId}`,
        expect.any(Object),
        300
      );
    });
  });

  // ── createDefaultMenuItem ─────────────────────────────────────────────────────

  describe('createDefaultMenuItem', () => {
    it('creates menu item and invalidates menu caches', async () => {
      const vendorId = 'vendor-1';
      const dbItem = makeDefaultMenuItem({ vendor_id: vendorId, name: 'New Burger' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const result = await service.createDefaultMenuItem(vendorId, {
        name: 'New Burger',
        categoryId: 'cat-1',
        type: 'FOOD',
        basePrice: 90,
      });

      expect(result.name).toBe('New Burger');
      expect(cacheMock.del).toHaveBeenCalledWith(
        `menu:default:${vendorId}`,
        `menu:categories:${vendorId}`,
        `menu:modifiers:${vendorId}`,
        `menu:templates:${vendorId}`
      );
    });

    it('throws validation error when required fields are missing', async () => {
      await expect(
        service.createDefaultMenuItem('vendor-1', {
          name: '',           // empty name should fail validation
          categoryId: 'cat-1',
          type: 'FOOD',
          basePrice: -1,      // negative price should fail
        })
      ).rejects.toThrow(/Validation failed/);
    });
  });

  // ── updateDefaultMenuItem ─────────────────────────────────────────────────────

  describe('updateDefaultMenuItem', () => {
    it('updates menu item and returns updated item', async () => {
      const vendorId = 'vendor-1';
      const itemId = 'item-1';
      const dbItem = makeDefaultMenuItem({ id: itemId, vendor_id: vendorId, name: 'Updated Burger' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const result = await service.updateDefaultMenuItem(vendorId, itemId, { name: 'Updated Burger' });

      expect(result.name).toBe('Updated Burger');
    });

    it('throws when item is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows found' } })
      );

      await expect(
        service.updateDefaultMenuItem('vendor-1', 'bad-item', { name: 'X' })
      ).rejects.toThrow('Failed to update menu item: No rows found');
    });
  });

  // ── deleteDefaultMenuItem ─────────────────────────────────────────────────────

  describe('deleteDefaultMenuItem', () => {
    it('hard-deletes item when no event items reference it', async () => {
      const vendorId = 'vendor-1';
      const itemId = 'item-1';

      const eventItemsMock = createSupabaseMock({ data: [], error: null });
      const deleteMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([eventItemsMock, deleteMock]);

      await expect(service.deleteDefaultMenuItem(vendorId, itemId)).resolves.toBeUndefined();

      expect(cacheMock.del).toHaveBeenCalledWith(
        `menu:default:${vendorId}`,
        `menu:categories:${vendorId}`,
        `menu:modifiers:${vendorId}`,
        `menu:templates:${vendorId}`
      );
    });

    it('soft-deletes (sets is_active=false) when event items reference it', async () => {
      const vendorId = 'vendor-1';
      const itemId = 'item-referenced';

      // event_menu_items query returns a reference, triggering soft-delete
      const eventItemsMock = createSupabaseMock({ data: [{ id: 'event-item-1' }], error: null });
      const softDeleteMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([eventItemsMock, softDeleteMock]);

      await expect(service.deleteDefaultMenuItem(vendorId, itemId)).resolves.toBeUndefined();
    });
  });

  // ── bulkCreateDefaultMenuItems ────────────────────────────────────────────────

  describe('bulkCreateDefaultMenuItems', () => {
    it('inserts multiple items and returns them all', async () => {
      const vendorId = 'vendor-1';
      const dbItems = [
        makeDefaultMenuItem({ vendor_id: vendorId, name: 'Item 1' }),
        makeDefaultMenuItem({ vendor_id: vendorId, name: 'Item 2' }),
      ];

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItems, error: null })
      );

      const result = await service.bulkCreateDefaultMenuItems(vendorId, [
        { name: 'Item 1', categoryId: 'cat-1', type: 'FOOD', basePrice: 80 },
        { name: 'Item 2', categoryId: 'cat-1', type: 'FOOD', basePrice: 90 },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Item 1');
      expect(result[1].name).toBe('Item 2');
    });

    it('throws validation error when any item fails validation', async () => {
      await expect(
        service.bulkCreateDefaultMenuItems('vendor-1', [
          { name: 'Valid Item', categoryId: 'cat-1', type: 'FOOD', basePrice: 80 },
          { name: '', categoryId: 'cat-1', type: 'FOOD', basePrice: -5 }, // invalid
        ])
      ).rejects.toThrow(/validation failed/i);
    });
  });

  // ── getEventMenu ──────────────────────────────────────────────────────────────

  describe('getEventMenu', () => {
    it('returns cached event menu when cache hits', async () => {
      const cachedMenu = {
        event: { id: 'event-1', name: 'Test Event', startDate: '', endDate: '' },
        vendor: { id: 'vendor-1', name: 'Test Vendor' },
        configuration: {} as any,
        categories: [],
        menuItems: [],
        modifierGroups: [],
        tags: [],
      };
      cacheMock.get.mockResolvedValueOnce(cachedMenu);

      const result = await service.getEventMenu('vendor-1', 'event-1');

      expect(result).toEqual(cachedMenu);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('builds and returns event-overridden menu on cache miss', async () => {
      const vendorId = 'vendor-1';
      const eventId = 'event-1';
      const defaultItemId = 'default-item-1';

      cacheMock.get.mockResolvedValueOnce(null);

      const dbEvent = { id: eventId, name: 'Test Event', start_date: '2026-01-01', end_date: '2026-01-02' };
      const dbVendor = { id: vendorId, name: 'Test Vendor' };
      const dbConfig = makeDbEventMenuConfig({ event_id: eventId, vendor_id: vendorId });
      const dbEventItems: any[] = []; // config event items
      const dbCategories = [makeDbMenuCategory({ vendor_id: vendorId })];
      const dbDefaultItems = [
        makeDefaultMenuItem({ id: defaultItemId, vendor_id: vendorId, is_active: true }),
      ];
      const dbEventMenuItems: any[] = []; // no overrides

      const eventMock = createSupabaseMock({ data: dbEvent, error: null });
      const vendorMock = createSupabaseMock({ data: dbVendor, error: null });
      // getOrCreateEventMenuConfig - existing config
      const configMock = createSupabaseMock({ data: dbConfig, error: null });
      const configEventItemsMock = createSupabaseMock({ data: dbEventItems, error: null });
      const categoriesMock = createSupabaseMock({ data: dbCategories, error: null });
      const defaultItemsMock = createSupabaseMock({ data: dbDefaultItems, error: null });
      const eventMenuItemsMock = createSupabaseMock({ data: dbEventMenuItems, error: null });
      // modifier groups (all + filtered) and modifiers
      const allGroupsMock = createSupabaseMock({ data: [], error: null });
      const filteredGroupsMock = createSupabaseMock({ data: [], error: null });
      const modifiersMock = createSupabaseMock({ data: [], error: null });
      const tagsMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([
        eventMock,
        vendorMock,
        configMock,
        configEventItemsMock,
        categoriesMock,
        defaultItemsMock,
        eventMenuItemsMock,
        allGroupsMock,
        filteredGroupsMock,
        modifiersMock,
        tagsMock,
      ]);

      const result = await service.getEventMenu(vendorId, eventId);

      expect(result.event.id).toBe(eventId);
      expect(result.vendor.id).toBe(vendorId);
      expect(result.menuItems).toHaveLength(1); // virtual item created for default item
      expect(cacheMock.set).toHaveBeenCalledWith(
        `menu:event:${vendorId}:${eventId}`,
        expect.any(Object),
        300
      );
    });
  });

  // ── upsertEventMenuItem ───────────────────────────────────────────────────────

  describe('upsertEventMenuItem', () => {
    it('creates a new event menu item when none exists', async () => {
      const vendorId = 'vendor-1';
      const eventId = 'event-1';
      const defaultItemId = 'default-item-1';
      const dbEventItem = makeEventMenuItem({
        vendor_id: vendorId,
        event_id: eventId,
        default_menu_item_id: defaultItemId,
      });

      // Lookup for existing item returns nothing (insert path)
      const existingMock = createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'Not found' } });
      const insertMock = createSupabaseMock({ data: dbEventItem, error: null });

      mockFromSequence([existingMock, insertMock]);

      const result = await service.upsertEventMenuItem(vendorId, eventId, {
        eventId,
        defaultMenuItemId: defaultItemId,
        isIncluded: true,
        isFeaturedAtEvent: false,
      });

      expect(result.defaultMenuItemId).toBe(defaultItemId);
      expect(result.isIncluded).toBe(true);
    });

    it('updates an existing event menu item when one exists', async () => {
      const vendorId = 'vendor-1';
      const eventId = 'event-1';
      const existingEventItemId = 'existing-event-item-1';
      const defaultItemId = 'default-item-1';
      const dbEventItem = makeEventMenuItem({
        id: existingEventItemId,
        vendor_id: vendorId,
        event_id: eventId,
        default_menu_item_id: defaultItemId,
        price_override: 120,
      });

      // Existing item found
      const existingMock = createSupabaseMock({ data: { id: existingEventItemId }, error: null });
      const updateMock = createSupabaseMock({ data: dbEventItem, error: null });

      mockFromSequence([existingMock, updateMock]);

      const result = await service.upsertEventMenuItem(vendorId, eventId, {
        eventId,
        defaultMenuItemId: defaultItemId,
        priceOverride: 120,
        isIncluded: true,
        isFeaturedAtEvent: false,
      });

      expect(result.id).toBe(existingEventItemId);
    });
  });

  // ── updateEventMenuConfig ─────────────────────────────────────────────────────

  describe('updateEventMenuConfig', () => {
    it('updates config fields and returns updated config', async () => {
      const vendorId = 'vendor-1';
      const eventId = 'event-1';
      const dbConfig = makeDbEventMenuConfig({
        vendor_id: vendorId,
        event_id: eventId,
        is_accepting_orders: false,
      });

      const configUpdateMock = createSupabaseMock({ data: dbConfig, error: null });
      const eventItemsMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([configUpdateMock, eventItemsMock]);

      const result = await service.updateEventMenuConfig(vendorId, eventId, {
        isAcceptingOrders: false,
      });

      expect(result.isAcceptingOrders).toBe(false);
    });

    it('throws when config update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Config update failed' } })
      );

      await expect(
        service.updateEventMenuConfig('vendor-1', 'event-1', { isAcceptingOrders: true })
      ).rejects.toThrow('Failed to update event config: Config update failed');
    });
  });

  // ── publishEventMenu ──────────────────────────────────────────────────────────

  describe('publishEventMenu', () => {
    it('sets event menu status to PUBLISHED', async () => {
      const vendorId = 'vendor-1';
      const eventId = 'event-1';
      const dbConfig = makeDbEventMenuConfig({
        vendor_id: vendorId,
        event_id: eventId,
        status: 'PUBLISHED',
        published_at: new Date().toISOString(),
      });

      const configUpdateMock = createSupabaseMock({ data: dbConfig, error: null });
      const eventItemsMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([configUpdateMock, eventItemsMock]);

      const result = await service.publishEventMenu(vendorId, eventId);

      expect(result.status).toBe('PUBLISHED');
    });
  });

  // ── getOrCreateEventMenuConfig ────────────────────────────────────────────────

  describe('getOrCreateEventMenuConfig', () => {
    it('returns existing config when found', async () => {
      const vendorId = 'vendor-1';
      const eventId = 'event-1';
      const dbConfig = makeDbEventMenuConfig({ vendor_id: vendorId, event_id: eventId });
      const dbEventItems = [makeEventMenuItem({ vendor_id: vendorId, event_id: eventId })];

      const configMock = createSupabaseMock({ data: dbConfig, error: null });
      const eventItemsMock = createSupabaseMock({ data: dbEventItems, error: null });

      mockFromSequence([configMock, eventItemsMock]);

      const result = await service.getOrCreateEventMenuConfig(vendorId, eventId);

      expect(result.vendorId).toBe(vendorId);
      expect(result.eventId).toBe(eventId);
    });

    it('creates and returns new config when none exists', async () => {
      const vendorId = 'vendor-new';
      const eventId = 'event-new';
      const newDbConfig = makeDbEventMenuConfig({
        vendor_id: vendorId,
        event_id: eventId,
        status: 'DRAFT',
      });

      // Lookup returns no config
      const notFoundMock = createSupabaseMock({
        data: null,
        error: { code: 'PGRST116', message: 'No rows' },
      });
      // Insert of new config
      const insertMock = createSupabaseMock({ data: newDbConfig, error: null });

      mockFromSequence([notFoundMock, insertMock]);

      const result = await service.getOrCreateEventMenuConfig(vendorId, eventId);

      expect(result.status).toBe('DRAFT');
    });
  });

  // ── getVendorCategories ───────────────────────────────────────────────────────

  describe('getVendorCategories', () => {
    it('returns categories for vendor', async () => {
      const vendorId = 'vendor-1';
      const dbCategories = [
        makeDbMenuCategory({ vendor_id: vendorId, name: 'Mains' }),
        makeDbMenuCategory({ vendor_id: vendorId, name: 'Drinks' }),
      ];

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbCategories, error: null })
      );

      const result = await service.getVendorCategories(vendorId);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Mains');
      expect(result[1].name).toBe('Drinks');
    });

    it('returns empty array when vendor has no categories', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null })
      );

      const result = await service.getVendorCategories('empty-vendor');

      expect(result).toEqual([]);
    });
  });

  // ── createCategory ────────────────────────────────────────────────────────────

  describe('createCategory', () => {
    it('creates category and returns it', async () => {
      const vendorId = 'vendor-1';
      const dbCategory = makeDbMenuCategory({ vendor_id: vendorId, name: 'Desserts' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbCategory, error: null })
      );

      const result = await service.createCategory(vendorId, {
        name: 'Desserts',
        displayOrder: 3,
        isActive: true,
        slug: 'desserts',
      });

      expect(result.name).toBe('Desserts');
    });

    it('throws when category creation fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Duplicate slug' } })
      );

      await expect(
        service.createCategory('vendor-1', { name: 'Mains', displayOrder: 0, isActive: true, slug: 'mains' })
      ).rejects.toThrow('Failed to create category: Duplicate slug');
    });
  });

  // ── getVendorModifierGroups ───────────────────────────────────────────────────

  describe('getVendorModifierGroups', () => {
    it('returns modifier groups with their modifiers', async () => {
      const vendorId = 'vendor-1';
      const groupId = 'group-1';
      const dbGroups = [makeDbModifierGroup({ id: groupId, vendor_id: vendorId, name: 'Size' })];
      const dbModifiers = [
        makeDbModifier({ group_id: groupId, name: 'Small' }),
        makeDbModifier({ group_id: groupId, name: 'Large' }),
      ];

      // Filtered groups query + modifiers query
      const filteredGroupsMock = createSupabaseMock({ data: dbGroups, error: null });
      const modifiersMock = createSupabaseMock({ data: dbModifiers, error: null });

      mockFromSequence([filteredGroupsMock, modifiersMock]);

      const result = await service.getVendorModifierGroups(vendorId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Size');
      expect(result[0].modifiers).toHaveLength(2);
    });

    it('returns empty array when vendor has no modifier groups', async () => {
      const filteredGroupsMock = createSupabaseMock({ data: [], error: null });
      const modifiersMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([filteredGroupsMock, modifiersMock]);

      const result = await service.getVendorModifierGroups('empty-vendor');

      expect(result).toEqual([]);
    });
  });

  // ── createModifierGroup ───────────────────────────────────────────────────────

  describe('createModifierGroup', () => {
    it('creates modifier group with no modifiers and returns it', async () => {
      const vendorId = 'vendor-1';
      const dbGroup = makeDbModifierGroup({ vendor_id: vendorId, name: 'Toppings' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbGroup, error: null })
      );

      const result = await service.createModifierGroup(vendorId, {
        name: 'Toppings',
        selectionType: 'MULTIPLE',
        isRequired: false,
        minSelections: 0,
        maxSelections: 5,
        displayOrder: 0,
        isActive: true,
      });

      expect(result.name).toBe('Toppings');
      expect(result.modifiers).toEqual([]);
    });

    it('throws when group creation fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Duplicate group name' } })
      );

      await expect(
        service.createModifierGroup('vendor-1', {
          name: 'Toppings',
          selectionType: 'MULTIPLE',
          isRequired: false,
          minSelections: 0,
          maxSelections: 5,
          displayOrder: 0,
          isActive: true,
        })
      ).rejects.toThrow('Failed to create modifier group: Duplicate group name');
    });
  });

  // ── addModifier ───────────────────────────────────────────────────────────────

  describe('addModifier', () => {
    it('adds modifier to existing group and returns it', async () => {
      const vendorId = 'vendor-1';
      const groupId = 'group-1';
      const dbGroup = makeDbModifierGroup({ id: groupId, vendor_id: vendorId });
      const dbModifier = makeDbModifier({ group_id: groupId, name: 'Extra Cheese' });

      const groupMock = createSupabaseMock({ data: { id: groupId }, error: null });
      const modifierMock = createSupabaseMock({ data: dbModifier, error: null });

      mockFromSequence([groupMock, modifierMock]);

      const result = await service.addModifier(vendorId, groupId, {
        name: 'Extra Cheese',
        priceAdjustment: 10,
        isDefault: false,
        isAvailable: true,
        displayOrder: 0,
      });

      expect(result.name).toBe('Extra Cheese');
    });

    it('throws when modifier group is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'Not found' } })
      );

      await expect(
        service.addModifier('vendor-1', 'nonexistent-group', {
          name: 'X',
          priceAdjustment: 0,
          isDefault: false,
          isAvailable: true,
          displayOrder: 0,
        })
      ).rejects.toThrow('Modifier group not found');
    });
  });

  // ── cloneEventMenu ────────────────────────────────────────────────────────────

  describe('cloneEventMenu', () => {
    it('copies items from source event to target event', async () => {
      const vendorId = 'vendor-1';
      const sourceEventId = 'event-source';
      const targetEventId = 'event-target';
      const sourceItems = [
        makeEventMenuItem({ vendor_id: vendorId, event_id: sourceEventId }),
        makeEventMenuItem({ vendor_id: vendorId, event_id: sourceEventId }),
      ];

      const sourceMock = createSupabaseMock({ data: sourceItems, error: null });
      // includeOverrides=true path: batch upsert returns upserted items
      const upsertMock = createSupabaseMock({ data: sourceItems, error: null });

      mockFromSequence([sourceMock, upsertMock]);

      const result = await service.cloneEventMenu(vendorId, {
        sourceEventId,
        targetEventId,
        includeOverrides: true,
      });

      expect(result.clonedCount).toBe(2);
    });

    it('returns clonedCount=0 when source event has no items', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null })
      );

      const result = await service.cloneEventMenu('vendor-1', {
        sourceEventId: 'empty-source',
        targetEventId: 'target',
        includeOverrides: false,
      });

      expect(result.clonedCount).toBe(0);
    });
  });

  // ── bulkPriceAdjustment ───────────────────────────────────────────────────────

  describe('bulkPriceAdjustment', () => {
    it('applies PERCENTAGE price adjustment correctly', async () => {
      const vendorId = 'vendor-1';
      const eventId = 'event-1';
      const dbItems = [
        { id: 'item-1', base_price: 100, name: 'Burger' },
        { id: 'item-2', base_price: 50, name: 'Fries' },
      ];

      const itemsMock = createSupabaseMock({ data: dbItems, error: null });
      const upsertMock = createSupabaseMock({ data: null, error: null });

      // 2 calls: 1 items query + 1 batch upsert (all items in single call)
      mockFromSequence([itemsMock, upsertMock]);

      const result = await service.bulkPriceAdjustment(vendorId, {
        eventId,
        adjustment: { type: 'PERCENTAGE', value: 10, direction: 'INCREASE' },
      });

      expect(result.updatedCount).toBe(2);
    });

    it('applies FIXED price adjustment correctly', async () => {
      const vendorId = 'vendor-1';
      const eventId = 'event-1';
      const dbItems = [
        { id: 'item-1', base_price: 100, name: 'Burger' },
      ];

      const itemsMock = createSupabaseMock({ data: dbItems, error: null });
      const upsertMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([itemsMock, upsertMock]);

      const result = await service.bulkPriceAdjustment(vendorId, {
        eventId,
        adjustment: { type: 'FIXED', value: 20, direction: 'INCREASE' },
      });

      expect(result.updatedCount).toBe(1);
    });

    it('returns updatedCount=0 when no items match the query', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null })
      );

      const result = await service.bulkPriceAdjustment('vendor-1', {
        eventId: 'event-1',
        adjustment: { type: 'PERCENTAGE', value: 10, direction: 'INCREASE' },
      });

      expect(result.updatedCount).toBe(0);
    });
  });

  // ── resetEventMenuPrices ──────────────────────────────────────────────────────

  describe('resetEventMenuPrices', () => {
    it('clears price overrides from all event menu items', async () => {
      const vendorId = 'vendor-1';
      const eventId = 'event-1';
      const currentItems = [
        {
          id: 'event-item-1',
          default_menu_item_id: 'item-1',
          price_override: 120,
          default_menu_items: { base_price: 100, name: 'Burger' },
        },
        {
          id: 'event-item-2',
          default_menu_item_id: 'item-2',
          price_override: null, // already at default
          default_menu_items: { base_price: 50, name: 'Fries' },
        },
      ];

      // fetch current items
      const fetchMock = createSupabaseMock({ data: currentItems, error: null });
      // update price_override to null
      const updateMock = createSupabaseMock({
        data: [{ id: 'event-item-1' }, { id: 'event-item-2' }],
        error: null,
      });
      // remove global price adjustment from config
      const configUpdateMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([fetchMock, updateMock, configUpdateMock]);

      const result = await service.resetEventMenuPrices(vendorId, eventId);

      expect(result.resetCount).toBe(2);
    });

    it('returns resetCount=0 when no event items exist', async () => {
      const fetchMock = createSupabaseMock({ data: [], error: null });
      const updateMock = createSupabaseMock({ data: [], error: null });
      const configUpdateMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([fetchMock, updateMock, configUpdateMock]);

      const result = await service.resetEventMenuPrices('vendor-1', 'empty-event');

      expect(result.resetCount).toBe(0);
    });
  });
});
