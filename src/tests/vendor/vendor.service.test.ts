import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { cacheMock, redisMock } from '../mocks/redis.js';
import { makeVendor, makeDefaultMenuItem, makeCategory, makeOrder } from '../fixtures/index.js';

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
import { VendorService } from '../../vendor/vendor.service.js';

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

describe('VendorService', () => {
  let service: VendorService;

  beforeEach(() => {
    vi.resetAllMocks();
    // Restore default cache behaviour: cache miss unless overridden per test
    cacheMock.get.mockResolvedValue(null);
    cacheMock.set.mockResolvedValue(undefined);
    cacheMock.del.mockResolvedValue(undefined);
    service = new VendorService();
  });

  // ── getAllVendors ────────────────────────────────────────────────────────────

  describe('getAllVendors', () => {
    it('returns cached vendors when cache hits', async () => {
      const vendors = [makeVendor(), makeVendor()];
      // fromDbVendor mapping - return already-mapped shape
      const mappedVendors = vendors.map(v => ({
        id: v.id,
        name: v.name,
        description: v.description,
        phone: v.phone,
        email: v.email,
        imageUrl: v.image_url,
        logoUrl: v.logo_url,
        categoryId: v.category_id,
        categoryIds: [],
        categories: undefined,
        cuisineType: v.cuisine_type,
        rating: v.rating,
        totalReviews: v.total_reviews,
        location: v.location,
        hours: undefined,
        isActive: v.is_active,
        isPaused: v.is_paused,
        minimumOrder: v.minimum_order,
        deliveryFee: undefined,
        serviceFeePercent: v.service_fee_percent,
        estimatedPrepTime: v.estimated_prep_time,
        paymentMethods: v.payment_methods,
        createdAt: v.created_at,
        updatedAt: v.updated_at,
      }));

      cacheMock.get.mockResolvedValueOnce(mappedVendors);

      const result = await service.getAllVendors();

      expect(result).toEqual(mappedVendors);
      // Supabase should not be called when cache hits
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('fetches from Supabase on cache miss and caches the result', async () => {
      const dbVendors = [makeVendor({ name: 'Vendor A' }), makeVendor({ name: 'Vendor B' })];

      cacheMock.get.mockResolvedValueOnce(null); // cache miss

      // 1st call: vendors, 2nd call: vendor_categories enrichment
      const vendorsMock = createSupabaseMock({ data: dbVendors, error: null });
      const enrichMock = createSupabaseMock({ data: [], error: null });
      mockFromSequence([vendorsMock, enrichMock]);

      const result = await service.getAllVendors();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Vendor A');
      expect(result[1].name).toBe('Vendor B');
      expect(cacheMock.set).toHaveBeenCalledWith(
        'vendors:all',
        expect.any(Array),
        3600 // CACHE_TTL.VENDOR_LIST
      );
    });

    it('throws when Supabase returns an error', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'DB failure' } })
      );

      await expect(service.getAllVendors()).rejects.toThrow('Failed to fetch vendors: DB failure');
    });
  });

  // ── getVendorById ────────────────────────────────────────────────────────────

  describe('getVendorById', () => {
    it('returns vendor from cache on cache hit', async () => {
      const dbVendor = makeVendor({ id: 'vendor-1' });
      const mappedVendor = { id: 'vendor-1', name: dbVendor.name, isActive: true, isPaused: false } as any;

      cacheMock.get.mockResolvedValueOnce(mappedVendor);

      const result = await service.getVendorById('vendor-1');

      expect(result).toEqual(mappedVendor);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('fetches vendor from Supabase on cache miss and caches it', async () => {
      const dbVendor = makeVendor({ id: 'vendor-2' });

      cacheMock.get.mockResolvedValueOnce(null);
      // 1st call: vendor, 2nd call: vendor_categories enrichment
      const vendorMock = createSupabaseMock({ data: dbVendor, error: null });
      const enrichMock = createSupabaseMock({ data: [], error: null });
      mockFromSequence([vendorMock, enrichMock]);

      const result = await service.getVendorById('vendor-2');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('vendor-2');
      expect(cacheMock.set).toHaveBeenCalledWith(
        'vendor:vendor-2',
        expect.anything(),
        60 // CACHE_TTL.VENDOR_DETAILS
      );
    });

    it('returns null when vendor is not found (no data)', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null })
      );

      const result = await service.getVendorById('nonexistent');

      expect(result).toBeNull();
    });

    it('throws when Supabase returns an error', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Connection error' } })
      );

      await expect(service.getVendorById('any-id')).rejects.toThrow(
        'Failed to fetch vendor: Connection error'
      );
    });
  });

  // ── createVendor ─────────────────────────────────────────────────────────────

  describe('createVendor', () => {
    it('inserts vendor, syncs categories, and returns with cache invalidation', async () => {
      const newVendorData = {
        name: 'New Vendor',
        phone: '0811111111',
        email: 'new@vendor.com',
        isActive: true,
        isPaused: false,
        paymentMethods: ['CASH'],
        categoryIds: ['cat-1'],
      } as any;

      const dbVendor = makeVendor({ id: 'created-id', name: 'New Vendor' });
      const dbVendorWithCats = makeVendor({
        id: 'created-id',
        name: 'New Vendor',
        vendor_categories: [{ category_id: 'cat-1', categories: { id: 'cat-1', name: 'Food' } }],
      });

      // 1. insert vendor
      const insertMock = createSupabaseMock({ data: dbVendor, error: null });
      // 2. delete old vendor_categories
      const deleteCatsMock = createSupabaseMock({ data: null, error: null });
      // 3. insert vendor_categories
      const insertCatsMock = createSupabaseMock({ data: null, error: null });
      // 4. fetch vendor with categories
      const fetchMock = createSupabaseMock({ data: dbVendorWithCats, error: null });

      mockFromSequence([insertMock, deleteCatsMock, insertCatsMock, fetchMock]);

      const result = await service.createVendor(newVendorData);

      expect(result.name).toBe('New Vendor');
      expect(result.categoryIds).toEqual(['cat-1']);
      expect(cacheMock.del).toHaveBeenCalledWith('vendors:all');
    });

    it('throws when insert fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Duplicate email' } })
      );

      await expect(service.createVendor({ categoryIds: ['cat-1'] } as any)).rejects.toThrow(
        'Failed to create vendor: Duplicate email'
      );
    });
  });

  // ── updateVendor ─────────────────────────────────────────────────────────────

  describe('updateVendor', () => {
    it('updates vendor and returns the updated vendor', async () => {
      const dbVendor = makeVendor({ id: 'vendor-to-update', name: 'Updated Name' });

      // 1. update vendor row
      const updateMock = createSupabaseMock({ data: dbVendor, error: null });
      // 2. fetch vendor with categories
      const fetchMock = createSupabaseMock({ data: dbVendor, error: null });

      mockFromSequence([updateMock, fetchMock]);

      const result = await service.updateVendor('vendor-to-update', { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      // cache invalidation includes specific vendor keys
      expect(cacheMock.del).toHaveBeenCalledWith(
        'vendors:all',
        'vendor:vendor-to-update',
        'vendor:vendor-to-update:stats'
      );
    });

    it('throws when update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Vendor not found' } })
      );

      await expect(service.updateVendor('missing-id', { name: 'X' })).rejects.toThrow(
        'Failed to update vendor: Vendor not found'
      );
    });
  });

  // ── deleteVendor ─────────────────────────────────────────────────────────────

  describe('deleteVendor', () => {
    it('deletes vendor and invalidates caches', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null })
      );

      await expect(service.deleteVendor('vendor-delete-id')).resolves.toBeUndefined();

      expect(cacheMock.del).toHaveBeenCalledWith(
        'vendors:all',
        'vendor:vendor-delete-id',
        'vendor:vendor-delete-id:stats'
      );
    });

    it('throws when delete fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Foreign key constraint' } })
      );

      await expect(service.deleteVendor('bad-id')).rejects.toThrow(
        'Failed to delete vendor: Foreign key constraint'
      );
    });
  });

  // ── toggleVendorStatus ───────────────────────────────────────────────────────

  describe('toggleVendorStatus', () => {
    it('activates vendor (isActive=true)', async () => {
      const dbVendor = makeVendor({ id: 'vendor-toggle', is_active: true });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

      const result = await service.toggleVendorStatus('vendor-toggle', true);

      expect(result).toEqual(dbVendor);
    });

    it('deactivates vendor (isActive=false)', async () => {
      const dbVendor = makeVendor({ id: 'vendor-toggle', is_active: false });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

      const result = await service.toggleVendorStatus('vendor-toggle', false);

      expect((result as any).is_active).toBe(false);
    });

    it('throws when Supabase update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Update error' } })
      );

      await expect(service.toggleVendorStatus('bad-id', true)).rejects.toThrow(
        'Failed to toggle vendor status: Update error'
      );
    });
  });

  // ── pauseVendor ──────────────────────────────────────────────────────────────

  describe('pauseVendor', () => {
    it('pauses vendor (isPaused=true)', async () => {
      const dbVendor = makeVendor({ id: 'vendor-pause', is_paused: true });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

      const result = await service.pauseVendor('vendor-pause', true);

      expect((result as any).is_paused).toBe(true);
    });

    it('unpauses vendor (isPaused=false)', async () => {
      const dbVendor = makeVendor({ id: 'vendor-pause', is_paused: false });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

      const result = await service.pauseVendor('vendor-pause', false);

      expect((result as any).is_paused).toBe(false);
    });

    it('throws when Supabase update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Pause error' } })
      );

      await expect(service.pauseVendor('bad-id', true)).rejects.toThrow(
        'Failed to pause vendor: Pause error'
      );
    });
  });

  // ── getVendorsByCategory ──────────────────────────────────────────────────────

  describe('getVendorsByCategory', () => {
    it('returns filtered vendors from cache when cache hits', async () => {
      const cachedVendors = [{ id: 'v1', name: 'Pizza Place', isActive: true } as any];
      cacheMock.get.mockResolvedValueOnce(cachedVendors);

      const result = await service.getVendorsByCategory('cat-pizza');

      expect(result).toEqual(cachedVendors);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('fetches via junction table on cache miss and caches result', async () => {
      const dbVendors = [makeVendor({ name: 'Pizza Palace' })];
      cacheMock.get.mockResolvedValueOnce(null);

      // 1st call: vendor_categories junction
      const junctionMock = createSupabaseMock({ data: [{ vendor_id: dbVendors[0].id }], error: null });
      // 2nd call: vendors
      const vendorsMock = createSupabaseMock({ data: dbVendors, error: null });
      // 3rd call: enrichWithCategories
      const enrichMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([junctionMock, vendorsMock, enrichMock]);

      const result = await service.getVendorsByCategory('cat-pizza');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pizza Palace');
      expect(cacheMock.set).toHaveBeenCalledWith(
        'vendors:category:cat-pizza',
        expect.any(Array),
        3600
      );
    });

    it('returns empty array when no vendors in category', async () => {
      cacheMock.get.mockResolvedValueOnce(null);

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null })
      );

      const result = await service.getVendorsByCategory('cat-empty');

      expect(result).toEqual([]);
    });

    it('throws when Supabase returns an error', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Category query failed' } })
      );

      await expect(service.getVendorsByCategory('broken')).rejects.toThrow(
        'Failed to fetch vendors by category: Category query failed'
      );
    });
  });

  // ── getVendorsByEvent ────────────────────────────────────────────────────────

  describe('getVendorsByEvent', () => {
    it('returns paginated result with total when vendors are found', async () => {
      const eventId = 'event-abc';
      const vendorId = 'vendor-1';
      const dbVendors = [makeVendor({ id: vendorId })];
      const dbMenuItems = [makeDefaultMenuItem({ vendor_id: vendorId })];

      cacheMock.get.mockResolvedValueOnce(null);

      // getEventByIdOrCode (events table, found by ID)
      const eventMock = createSupabaseMock({ data: { id: eventId }, error: null });
      // event_vendors junction (now includes display_order)
      const junctionMock = createSupabaseMock({ data: [{ vendor_id: vendorId, display_order: null }], error: null });
      // vendors query (no count, no range)
      const vendorsMock = createSupabaseMock({ data: dbVendors, error: null });
      // enrichWithCategories
      const enrichMock = createSupabaseMock({ data: [], error: null });
      // menu items (all vendors, no limit)
      const menuMock = createSupabaseMock({ data: dbMenuItems, error: null });
      // event_menu_configurations (getVendorEventStatuses)
      const statusMock = createSupabaseMock({ data: [], error: null });
      // orders (getVendorOrderCounts)
      const ordersMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([eventMock, junctionMock, vendorsMock, enrichMock, menuMock, statusMock, ordersMock]);

      const result = await service.getVendorsByEvent(eventId, { page: 1, pageSize: 20 });

      expect(result).toMatchObject({
        id: eventId,
        page: 1,
        pageSize: 20,
        vendors: expect.any(Array),
      });
      expect(result.vendors[0]).toHaveProperty('orderCount');
      expect(result.vendors[0]).toHaveProperty('eventStatus');
    });

    it('returns empty result when no vendors assigned to event', async () => {
      const eventId = 'empty-event';

      cacheMock.get.mockResolvedValueOnce(null);

      const eventMock = createSupabaseMock({ data: { id: eventId }, error: null });
      const junctionMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([eventMock, junctionMock]);

      const result = await service.getVendorsByEvent(eventId);

      expect(result.vendors).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('throws when event not found', async () => {
      cacheMock.get.mockResolvedValueOnce(null);

      // both ID and code lookups return no data
      const notFoundMock = createSupabaseMock({ data: null, error: { message: 'Not found' } });
      mockFromSequence([notFoundMock, notFoundMock]);

      await expect(service.getVendorsByEvent('nonexistent-event')).rejects.toThrow('Event not found');
    });

    it('sorts pinned vendors first by display_order', async () => {
      const eventId = 'event-sort';
      const v1 = makeVendor({ id: 'v-unpinned', name: 'Alpha' });
      const v2 = makeVendor({ id: 'v-pinned-2', name: 'Beta' });
      const v3 = makeVendor({ id: 'v-pinned-1', name: 'Gamma' });

      cacheMock.get.mockResolvedValueOnce(null);

      mockFromSequence([
        // event lookup
        createSupabaseMock({ data: { id: eventId }, error: null }),
        // junction with display_order
        createSupabaseMock({ data: [
          { vendor_id: 'v-unpinned', display_order: null },
          { vendor_id: 'v-pinned-2', display_order: 2 },
          { vendor_id: 'v-pinned-1', display_order: 1 },
        ], error: null }),
        // vendors
        createSupabaseMock({ data: [v1, v2, v3], error: null }),
        // enrichWithCategories
        createSupabaseMock({ data: [], error: null }),
        // menu items (all have menus)
        createSupabaseMock({ data: [
          makeDefaultMenuItem({ vendor_id: 'v-unpinned' }),
          makeDefaultMenuItem({ vendor_id: 'v-pinned-2' }),
          makeDefaultMenuItem({ vendor_id: 'v-pinned-1' }),
        ], error: null }),
        // event statuses (all open)
        createSupabaseMock({ data: [], error: null }),
        // order counts
        createSupabaseMock({ data: [], error: null }),
      ]);

      const result = await service.getVendorsByEvent(eventId);

      expect(result.vendors.map(v => v.id)).toEqual([
        'v-pinned-1', // display_order=1
        'v-pinned-2', // display_order=2
        'v-unpinned', // no pin
      ]);
    });

    it('sorts open vendors before closed vendors', async () => {
      const eventId = 'event-status-sort';
      const v1 = makeVendor({ id: 'v-closed', name: 'Alpha' });
      const v2 = makeVendor({ id: 'v-open', name: 'Beta' });

      cacheMock.get.mockResolvedValueOnce(null);

      mockFromSequence([
        createSupabaseMock({ data: { id: eventId }, error: null }),
        createSupabaseMock({ data: [
          { vendor_id: 'v-closed', display_order: null },
          { vendor_id: 'v-open', display_order: null },
        ], error: null }),
        createSupabaseMock({ data: [v1, v2], error: null }),
        createSupabaseMock({ data: [], error: null }), // enrichWithCategories
        createSupabaseMock({ data: [
          makeDefaultMenuItem({ vendor_id: 'v-closed' }),
          makeDefaultMenuItem({ vendor_id: 'v-open' }),
        ], error: null }),
        // event_menu_configurations: v-closed is CLOSED
        createSupabaseMock({ data: [
          { vendor_id: 'v-closed', is_accepting_orders: false, status: 'ACTIVE' },
        ], error: null }),
        createSupabaseMock({ data: [], error: null }), // orders
      ]);

      const result = await service.getVendorsByEvent(eventId);

      expect(result.vendors[0].id).toBe('v-open');
      expect(result.vendors[1].id).toBe('v-closed');
    });

    it('sorts vendors with menu above vendors without menu', async () => {
      const eventId = 'event-menu-sort';
      const v1 = makeVendor({ id: 'v-no-menu', name: 'Alpha' });
      const v2 = makeVendor({ id: 'v-has-menu', name: 'Beta' });

      cacheMock.get.mockResolvedValueOnce(null);

      mockFromSequence([
        createSupabaseMock({ data: { id: eventId }, error: null }),
        createSupabaseMock({ data: [
          { vendor_id: 'v-no-menu', display_order: null },
          { vendor_id: 'v-has-menu', display_order: null },
        ], error: null }),
        createSupabaseMock({ data: [v1, v2], error: null }),
        createSupabaseMock({ data: [], error: null }), // enrichWithCategories
        // Only v-has-menu has menu items
        createSupabaseMock({ data: [
          makeDefaultMenuItem({ vendor_id: 'v-has-menu' }),
        ], error: null }),
        createSupabaseMock({ data: [], error: null }), // statuses
        createSupabaseMock({ data: [], error: null }), // orders
      ]);

      const result = await service.getVendorsByEvent(eventId);

      expect(result.vendors[0].id).toBe('v-has-menu');
      expect(result.vendors[1].id).toBe('v-no-menu');
    });

    it('sorts by popularity (order count) descending', async () => {
      const eventId = 'event-pop-sort';
      const v1 = makeVendor({ id: 'v-few-orders', name: 'Alpha' });
      const v2 = makeVendor({ id: 'v-many-orders', name: 'Beta' });

      cacheMock.get.mockResolvedValueOnce(null);

      mockFromSequence([
        createSupabaseMock({ data: { id: eventId }, error: null }),
        createSupabaseMock({ data: [
          { vendor_id: 'v-few-orders', display_order: null },
          { vendor_id: 'v-many-orders', display_order: null },
        ], error: null }),
        createSupabaseMock({ data: [v1, v2], error: null }),
        createSupabaseMock({ data: [], error: null }), // enrichWithCategories
        createSupabaseMock({ data: [
          makeDefaultMenuItem({ vendor_id: 'v-few-orders' }),
          makeDefaultMenuItem({ vendor_id: 'v-many-orders' }),
        ], error: null }),
        createSupabaseMock({ data: [], error: null }), // statuses
        // orders: v-many-orders has 3 orders, v-few-orders has 1
        createSupabaseMock({ data: [
          { vendor_id: 'v-many-orders' },
          { vendor_id: 'v-many-orders' },
          { vendor_id: 'v-many-orders' },
          { vendor_id: 'v-few-orders' },
        ], error: null }),
      ]);

      const result = await service.getVendorsByEvent(eventId);

      expect(result.vendors[0].id).toBe('v-many-orders');
      expect(result.vendors[0].orderCount).toBe(3);
      expect(result.vendors[1].id).toBe('v-few-orders');
      expect(result.vendors[1].orderCount).toBe(1);
    });

    it('uses alphabetical name as final tiebreaker', async () => {
      const eventId = 'event-alpha-sort';
      const v1 = makeVendor({ id: 'v-zebra', name: 'Zebra Grill' });
      const v2 = makeVendor({ id: 'v-alpha', name: 'Alpha Kitchen' });

      cacheMock.get.mockResolvedValueOnce(null);

      mockFromSequence([
        createSupabaseMock({ data: { id: eventId }, error: null }),
        createSupabaseMock({ data: [
          { vendor_id: 'v-zebra', display_order: null },
          { vendor_id: 'v-alpha', display_order: null },
        ], error: null }),
        createSupabaseMock({ data: [v1, v2], error: null }),
        createSupabaseMock({ data: [], error: null }), // enrichWithCategories
        createSupabaseMock({ data: [
          makeDefaultMenuItem({ vendor_id: 'v-zebra' }),
          makeDefaultMenuItem({ vendor_id: 'v-alpha' }),
        ], error: null }),
        createSupabaseMock({ data: [], error: null }), // statuses
        createSupabaseMock({ data: [], error: null }), // orders
      ]);

      const result = await service.getVendorsByEvent(eventId);

      expect(result.vendors[0].name).toBe('Alpha Kitchen');
      expect(result.vendors[1].name).toBe('Zebra Grill');
    });

    it('paginates the sorted result correctly', async () => {
      const eventId = 'event-paginate';
      const vendors = Array.from({ length: 5 }, (_, i) =>
        makeVendor({ id: `v-${i}`, name: `Vendor ${String.fromCharCode(65 + i)}` })
      );

      cacheMock.get.mockResolvedValueOnce(null);

      mockFromSequence([
        createSupabaseMock({ data: { id: eventId }, error: null }),
        createSupabaseMock({ data: vendors.map(v => ({ vendor_id: v.id, display_order: null })), error: null }),
        createSupabaseMock({ data: vendors, error: null }),
        createSupabaseMock({ data: [], error: null }), // enrichWithCategories
        createSupabaseMock({ data: vendors.map(v =>
          makeDefaultMenuItem({ vendor_id: v.id })
        ), error: null }),
        createSupabaseMock({ data: [], error: null }), // statuses
        createSupabaseMock({ data: [], error: null }), // orders
      ]);

      const result = await service.getVendorsByEvent(eventId, { page: 2, pageSize: 2 });

      expect(result.total).toBe(5);
      expect(result.totalPages).toBe(3);
      expect(result.vendors).toHaveLength(2);
      expect(result.page).toBe(2);
    });
  });

  // ── searchVendors ─────────────────────────────────────────────────────────────

  describe('searchVendors', () => {
    it('returns matching vendors from cache when cache hits', async () => {
      const cachedResult = [{ id: 'v1', name: 'Pizza Place' } as any];
      cacheMock.get.mockResolvedValueOnce(cachedResult);

      const result = await service.searchVendors('pizza');

      expect(result).toEqual(cachedResult);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('searches vendors without event filter on cache miss', async () => {
      const dbVendors = [makeVendor({ name: 'Pizza Factory' })];
      cacheMock.get.mockResolvedValueOnce(null);

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendors, error: null })
      );

      const result = await service.searchVendors('pizza');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pizza Factory');
      expect(cacheMock.set).toHaveBeenCalledWith(
        'vendors:search:pizza',
        expect.any(Array),
        300 // CACHE_TTL.MENU_ITEMS
      );
    });

    it('filters by event when eventId is provided', async () => {
      const eventId = 'event-xyz';
      const vendorId = 'vendor-in-event';
      const dbVendors = [makeVendor({ id: vendorId, name: 'Event Pizza' })];

      cacheMock.get.mockResolvedValueOnce(null);

      const eventMock = createSupabaseMock({ data: { id: eventId }, error: null });
      const junctionMock = createSupabaseMock({
        data: [{ vendor_id: vendorId }],
        error: null,
      });
      const vendorsMock = createSupabaseMock({ data: dbVendors, error: null });

      mockFromSequence([eventMock, junctionMock, vendorsMock]);

      const result = await service.searchVendors('pizza', eventId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Event Pizza');
    });

    it('throws when search query fails', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Search failed' } })
      );

      await expect(service.searchVendors('broken')).rejects.toThrow(
        'Failed to search vendors: Search failed'
      );
    });
  });

  // ── getVendorStats ───────────────────────────────────────────────────────────

  describe('getVendorStats', () => {
    it('returns stats from cache when cache hits', async () => {
      const cachedStats = {
        totalOrders: 50,
        totalRevenue: 4000,
        averageRating: 4.5,
        todayOrders: 10,
        activeOrders: 3,
      };
      cacheMock.get.mockResolvedValueOnce(cachedStats);

      const result = await service.getVendorStats('vendor-1');

      expect(result).toEqual(cachedStats);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('computes stats from orders on cache miss', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const dbOrders = [
        makeOrder({
          vendor_id: 'vendor-1',
          total: 100,
          status: 'PENDING',
          created_at: new Date().toISOString(), // today
        }),
        makeOrder({
          vendor_id: 'vendor-1',
          total: 200,
          status: 'PREPARING',
          created_at: new Date().toISOString(), // today
        }),
        makeOrder({
          vendor_id: 'vendor-1',
          total: 300,
          status: 'COMPLETED',
          created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
        }),
      ];

      cacheMock.get.mockResolvedValueOnce(null);
      mockFromSequence([
        createSupabaseMock({ data: dbOrders, error: null }),        // revenue query: orders with total + status
        createSupabaseMock({ data: null, error: null, count: 2 }), // today count query (head: true)
        createSupabaseMock({ data: null, error: null, count: 2 }), // active count query (PENDING + PREPARING)
      ]);

      const result = await service.getVendorStats('vendor-1');

      expect(result.totalOrders).toBe(3);
      expect(result.totalRevenue).toBe(600);
      expect(result.todayOrders).toBe(2);
      expect(result.activeOrders).toBe(2); // PENDING + PREPARING
      expect(result.averageRating).toBe(0); // No reviews table in this service
      expect(cacheMock.set).toHaveBeenCalledWith(
        'vendor:vendor-1:stats',
        expect.any(Object),
        5 // CACHE_TTL.ACTIVE_ORDERS
      );
    });

    it('throws when stats query fails', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Stats query failed' } })
      );

      await expect(service.getVendorStats('bad-vendor')).rejects.toThrow(
        'Failed to fetch vendor stats: Stats query failed'
      );
    });
  });

  // ── getVendorsByCuisine ──────────────────────────────────────────────────────

  describe('getVendorsByCuisine', () => {
    it('returns cached vendors when cache hits', async () => {
      const vendors = [makeVendor({ cuisine_type: ['Pizza'] })];
      cacheMock.get.mockResolvedValueOnce(vendors);

      const result = await service.getVendorsByCuisine('Pizza');

      expect(result).toEqual(vendors);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('fetches from DB on cache miss and caches the result', async () => {
      const dbVendors = [
        makeVendor({ id: 'v1', cuisine_type: ['Pizza'], is_active: true }),
      ];

      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendors, error: null }),
      );

      const result = await service.getVendorsByCuisine('Pizza');

      expect(result).toHaveLength(1);
      expect(supabaseMock.from).toHaveBeenCalledWith('vendors');
      expect(cacheMock.set).toHaveBeenCalledWith(
        'vendors:cuisine:Pizza',
        expect.any(Array),
        3600,
      );
    });

    it('returns empty array when no vendors match the cuisine', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const result = await service.getVendorsByCuisine('Sushi');

      expect(result).toEqual([]);
    });

    it('throws when supabase returns an error', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'query failed' } }),
      );

      await expect(service.getVendorsByCuisine('Pizza')).rejects.toThrow(
        'Failed to fetch vendors by cuisine',
      );
    });
  });

  // ── getVendorsWithItemsInCategory ──────────────────────────────────────────

  describe('getVendorsWithItemsInCategory', () => {
    it('returns cached vendors when cache hits', async () => {
      const vendors = [makeVendor()];
      cacheMock.get.mockResolvedValueOnce(vendors);

      const result = await service.getVendorsWithItemsInCategory('cat-1');

      expect(result).toEqual(vendors);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('fetches vendors with items in category on cache miss', async () => {
      cacheMock.get.mockResolvedValueOnce(null);

      // 1st call: query default_menu_items → vendor_ids
      const itemsMock = createSupabaseMock({
        data: [{ vendor_id: 'v1' }, { vendor_id: 'v2' }, { vendor_id: 'v1' }],
        error: null,
      });

      // 2nd call: fetch vendors by those IDs
      const vendorsMock = createSupabaseMock({
        data: [makeVendor({ id: 'v1' }), makeVendor({ id: 'v2' })],
        error: null,
      });

      mockFromSequence([itemsMock, vendorsMock]);

      const result = await service.getVendorsWithItemsInCategory('cat-1');

      expect(result).toHaveLength(2);
      expect(cacheMock.set).toHaveBeenCalled();
    });

    it('returns empty array and caches when no items found in category', async () => {
      cacheMock.get.mockResolvedValueOnce(null);

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const result = await service.getVendorsWithItemsInCategory('cat-empty');

      expect(result).toEqual([]);
      expect(cacheMock.set).toHaveBeenCalledWith(
        expect.stringContaining('cat-empty'),
        [],
        3600,
      );
    });

    it('scopes to event vendors when eventIdOrCode is provided', async () => {
      cacheMock.get.mockResolvedValueOnce(null);

      // 1st call: getEventByIdOrCode → events (by ID)
      const eventMock = createSupabaseMock({ data: { id: 'event-1' }, error: null });
      // 2nd call: event_vendors
      const eventVendorsMock = createSupabaseMock({
        data: [{ vendor_id: 'v1' }],
        error: null,
      });
      // 3rd call: filterAvailableVendors → event_menu_configurations
      const configsMock = createSupabaseMock({
        data: [{ vendor_id: 'v1', is_accepting_orders: true, status: 'ACTIVE' }],
        error: null,
      });
      // 4th call: default_menu_items (filtered by allowed vendor IDs)
      const itemsMock = createSupabaseMock({
        data: [{ vendor_id: 'v1' }],
        error: null,
      });
      // 5th call: fetch vendors
      const vendorsMock = createSupabaseMock({
        data: [makeVendor({ id: 'v1' })],
        error: null,
      });

      mockFromSequence([eventMock, eventVendorsMock, configsMock, itemsMock, vendorsMock]);

      const result = await service.getVendorsWithItemsInCategory('cat-1', 'event-1');

      expect(result).toHaveLength(1);
    });

    it('returns empty when event has no vendors', async () => {
      cacheMock.get.mockResolvedValueOnce(null);

      // getEventByIdOrCode → event found
      const eventMock = createSupabaseMock({ data: { id: 'event-1' }, error: null });
      // event_vendors → empty
      const eventVendorsMock = createSupabaseMock({ data: [], error: null });

      mockFromSequence([eventMock, eventVendorsMock]);

      const result = await service.getVendorsWithItemsInCategory('cat-1', 'event-1');

      expect(result).toEqual([]);
    });

    it('throws when menu items query fails', async () => {
      cacheMock.get.mockResolvedValueOnce(null);

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'items query failed' } }),
      );

      await expect(
        service.getVendorsWithItemsInCategory('cat-1'),
      ).rejects.toThrow('Failed to fetch menu items for category');
    });
  });

  // ── getNearbyVendors ───────────────────────────────────────────────────────

  describe('getNearbyVendors', () => {
    it('returns vendors within the radius', async () => {
      // Cape Town coordinates
      const capeTown = { latitude: -33.9249, longitude: 18.4241 };
      // A vendor ~1km away
      const nearbyVendor = makeVendor({
        id: 'v-near',
        location: { latitude: -33.9300, longitude: 18.4250 },
        isActive: true,
      });
      // A vendor ~100km away
      const farVendor = makeVendor({
        id: 'v-far',
        location: { latitude: -34.8000, longitude: 19.4000 },
        isActive: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [nearbyVendor, farVendor], error: null }),
      );

      const result = await service.getNearbyVendors(
        capeTown.latitude,
        capeTown.longitude,
        5,
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('v-near');
    });

    it('returns empty array when no vendors are within radius', async () => {
      const farVendor = makeVendor({
        location: { latitude: 40.7128, longitude: -74.006 }, // New York
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [farVendor], error: null }),
      );

      const result = await service.getNearbyVendors(-33.9249, 18.4241, 5);

      expect(result).toEqual([]);
    });

    it('uses default 5km radius', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const result = await service.getNearbyVendors(-33.9249, 18.4241);

      expect(result).toEqual([]);
      expect(supabaseMock.from).toHaveBeenCalledWith('vendors');
    });

    it('throws when supabase returns an error', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'DB down' } }),
      );

      await expect(
        service.getNearbyVendors(-33.9249, 18.4241),
      ).rejects.toThrow('Failed to fetch nearby vendors');
    });
  });

  // ── invalidateCache ──────────────────────────────────────────────────────────

  describe('invalidateCache', () => {
    it('calls cache.del with "vendors:all" key when no vendorId given', async () => {
      await service.invalidateCache();

      expect(cacheMock.del).toHaveBeenCalledWith('vendors:all');
    });

    it('calls cache.del with all vendor-specific keys when vendorId is provided', async () => {
      await service.invalidateCache('vendor-123');

      expect(cacheMock.del).toHaveBeenCalledWith(
        'vendors:all',
        'vendor:vendor-123',
        'vendor:vendor-123:stats'
      );
    });
  });
});
