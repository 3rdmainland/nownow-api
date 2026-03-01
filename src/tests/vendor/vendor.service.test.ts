import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { cacheMock, redisMock } from '../mocks/redis.js';
import { makeVendor, makeMenuItem, makeCategory, makeOrder } from '../fixtures/index.js';

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

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendors, error: null })
      );

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
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

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
    it('inserts vendor and returns the created vendor with cache invalidation', async () => {
      const newVendorData = {
        name: 'New Vendor',
        phone: '0811111111',
        email: 'new@vendor.com',
        isActive: true,
        isPaused: false,
        paymentMethods: ['CASH'],
        categoryId: 'cat-1',
      } as any;

      const dbVendor = makeVendor({ id: 'created-id', name: 'New Vendor' });

      // insert returns the new vendor; invalidateVendorCaches calls del on 'vendors:all'
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

      const result = await service.createVendor(newVendorData);

      expect(result.name).toBe('New Vendor');
      expect(cacheMock.del).toHaveBeenCalledWith('vendors:all');
    });

    it('throws when insert fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Duplicate email' } })
      );

      await expect(service.createVendor({} as any)).rejects.toThrow(
        'Failed to create vendor: Duplicate email'
      );
    });
  });

  // ── updateVendor ─────────────────────────────────────────────────────────────

  describe('updateVendor', () => {
    it('updates vendor and returns the updated vendor', async () => {
      const dbVendor = makeVendor({ id: 'vendor-to-update', name: 'Updated Name' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

      const result = await service.updateVendor('vendor-to-update', { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      // cache invalidation includes specific vendor keys
      expect(cacheMock.del).toHaveBeenCalledWith(
        'vendors:all',
        'vendor:vendor-to-update',
        'vendor:vendor-to-update:menu',
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
        'vendor:vendor-delete-id:menu',
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

      expect(result.is_active).toBe(false);
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

      expect(result.is_paused).toBe(true);
    });

    it('unpauses vendor (isPaused=false)', async () => {
      const dbVendor = makeVendor({ id: 'vendor-pause', is_paused: false });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendor, error: null })
      );

      const result = await service.pauseVendor('vendor-pause', false);

      expect(result.is_paused).toBe(false);
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

      const result = await service.getVendorsByCategory('pizza');

      expect(result).toEqual(cachedVendors);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('fetches from Supabase on cache miss and caches result', async () => {
      const dbVendors = [makeVendor({ name: 'Pizza Palace' })];
      cacheMock.get.mockResolvedValueOnce(null);

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbVendors, error: null })
      );

      const result = await service.getVendorsByCategory('pizza');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pizza Palace');
      expect(cacheMock.set).toHaveBeenCalledWith(
        'vendors:category:pizza',
        expect.any(Array),
        3600
      );
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
      const dbMenuItems = [makeMenuItem({ vendor_id: vendorId, available: true })];

      cacheMock.get.mockResolvedValueOnce(null);

      // getEventByIdOrCode (events table, found by ID)
      const eventMock = createSupabaseMock({ data: { id: eventId }, error: null });
      // getVendorsByEvent cache miss - event_vendors junction
      const junctionMock = createSupabaseMock({ data: [{ vendor_id: vendorId }], error: null });
      // vendors query with count
      const vendorsMock = createSupabaseMock({ data: dbVendors, error: null });
      vendorsMock.single = vi.fn().mockResolvedValue({ data: dbVendors, error: null, count: 1 });
      // Override then to include count
      vendorsMock.then = vi.fn((resolve) =>
        Promise.resolve(resolve({ data: dbVendors, error: null, count: 1 }))
      );
      // menu items
      const menuMock = createSupabaseMock({ data: dbMenuItems, error: null });

      mockFromSequence([eventMock, junctionMock, vendorsMock, menuMock]);

      const result = await service.getVendorsByEvent(eventId, { page: 1, pageSize: 20 });

      expect(result).toMatchObject({
        id: eventId,
        page: 1,
        pageSize: 20,
        vendors: expect.any(Array),
      });
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

  // ── getVendorMenu ────────────────────────────────────────────────────────────

  describe('getVendorMenu', () => {
    it('returns menu groups from cache when cache hits', async () => {
      const cachedGroups = [{ category: { id: 'cat-1', name: 'Burgers' }, menuItems: [] }];
      cacheMock.get.mockResolvedValueOnce(cachedGroups);

      const result = await service.getVendorMenu('vendor-1');

      expect(result).toEqual(cachedGroups);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('fetches and groups menu items by category on cache miss', async () => {
      const categoryId = 'cat-burgers';
      const dbItems = [
        makeMenuItem({ vendor_id: 'vendor-1', category_id: categoryId, available: true }),
        makeMenuItem({ vendor_id: 'vendor-1', category_id: categoryId, available: true }),
      ];
      const dbCategories = [{ id: categoryId, name: 'Burgers' }];

      cacheMock.get.mockResolvedValueOnce(null);

      const menuItemsMock = createSupabaseMock({ data: dbItems, error: null });
      const categoriesMock = createSupabaseMock({ data: dbCategories, error: null });

      mockFromSequence([menuItemsMock, categoriesMock]);

      const result = await service.getVendorMenu('vendor-1');

      expect(result).toHaveLength(1);
      expect(result[0].category.name).toBe('Burgers');
      expect(result[0].menuItems).toHaveLength(2);
      expect(cacheMock.set).toHaveBeenCalledWith(
        'vendor:vendor-1:menu',
        expect.any(Array),
        300
      );
    });

    it('returns empty array when vendor has no menu items', async () => {
      cacheMock.get.mockResolvedValueOnce(null);
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null })
      );

      const result = await service.getVendorMenu('empty-vendor');

      expect(result).toEqual([]);
    });
  });

  // ── getMenuItemById ──────────────────────────────────────────────────────────

  describe('getMenuItemById', () => {
    it('returns menu item when found', async () => {
      const dbItem = makeMenuItem({ id: 'item-1', vendor_id: 'vendor-1' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const result = await service.getMenuItemById('vendor-1', 'item-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('item-1');
    });

    it('returns null when item not found (PGRST116 error code)', async () => {
      const mock = createSupabaseMock({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });
      supabaseMock.from.mockReturnValue(mock);

      const result = await service.getMenuItemById('vendor-1', 'nonexistent');

      expect(result).toBeNull();
    });

    it('throws on unexpected Supabase error', async () => {
      const mock = createSupabaseMock({
        data: null,
        error: { code: 'PGRST500', message: 'Database error' },
      });
      supabaseMock.from.mockReturnValue(mock);

      await expect(service.getMenuItemById('vendor-1', 'item-1')).rejects.toThrow(
        'Failed to fetch menu item: Database error'
      );
    });
  });

  // ── addMenuItem ───────────────────────────────────────────────────────────────

  describe('addMenuItem', () => {
    it('inserts menu item and returns the new item', async () => {
      const dbItem = makeMenuItem({ id: 'new-item', vendor_id: 'vendor-1', category_id: 'cat-1' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const result = await service.addMenuItem('vendor-1', {
        name: 'Burger',
        price: 80,
        type: 'FOOD',
        available: true,
        categoryId: 'cat-1',
        vendorId: 'vendor-1',
      } as any);

      expect(result.id).toBe('new-item');
      // Cache del called for vendor menu and category items
      expect(cacheMock.del).toHaveBeenCalledWith(
        'vendor:vendor-1:menu',
        expect.stringContaining('cat-1')
      );
    });

    it('throws when insert fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Item insert failed' } })
      );

      await expect(service.addMenuItem('vendor-1', {} as any)).rejects.toThrow(
        'Failed to add menu item: Item insert failed'
      );
    });
  });

  // ── updateMenuItem ───────────────────────────────────────────────────────────

  describe('updateMenuItem', () => {
    it('updates menu item and returns updated item', async () => {
      const dbItem = makeMenuItem({ id: 'item-1', vendor_id: 'vendor-1', category_id: 'cat-1', name: 'Updated Burger' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const result = await service.updateMenuItem('item-1', { name: 'Updated Burger' });

      expect(result.name).toBe('Updated Burger');
    });

    it('throws when update fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Update failed' } })
      );

      await expect(service.updateMenuItem('bad-item', {})).rejects.toThrow(
        'Failed to update menu item: Update failed'
      );
    });
  });

  // ── deleteMenuItem ───────────────────────────────────────────────────────────

  describe('deleteMenuItem', () => {
    it('deletes menu item and invalidates caches', async () => {
      const fetchMock = createSupabaseMock({
        data: { vendor_id: 'vendor-1', category_id: 'cat-1' },
        error: null,
      });
      const deleteMock = createSupabaseMock({ data: null, error: null });

      mockFromSequence([fetchMock, deleteMock]);

      await expect(service.deleteMenuItem('item-to-delete')).resolves.toBeUndefined();

      expect(cacheMock.del).toHaveBeenCalledWith(
        'vendor:vendor-1:menu',
        expect.stringContaining('cat-1')
      );
    });

    it('throws when fetch before delete fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Item not found' } })
      );

      await expect(service.deleteMenuItem('bad-item')).rejects.toThrow(
        'Failed to fetch menu item for deletion: Item not found'
      );
    });

    it('throws when delete operation fails', async () => {
      const fetchMock = createSupabaseMock({
        data: { vendor_id: 'vendor-1', category_id: 'cat-1' },
        error: null,
      });
      const deleteMock = createSupabaseMock({
        data: null,
        error: { message: 'Delete constraint violation' },
      });

      mockFromSequence([fetchMock, deleteMock]);

      await expect(service.deleteMenuItem('locked-item')).rejects.toThrow(
        'Failed to delete menu item: Delete constraint violation'
      );
    });
  });

  // ── toggleMenuItemAvailability ───────────────────────────────────────────────

  describe('toggleMenuItemAvailability', () => {
    it('marks item as available (available=true)', async () => {
      const dbItem = makeMenuItem({
        id: 'item-1',
        vendor_id: 'vendor-1',
        category_id: 'cat-1',
        available: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const result = await service.toggleMenuItemAvailability('item-1', true);

      expect(result.available).toBe(true);
    });

    it('marks item as unavailable (available=false)', async () => {
      const dbItem = makeMenuItem({
        id: 'item-1',
        vendor_id: 'vendor-1',
        category_id: 'cat-1',
        available: false,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbItem, error: null })
      );

      const result = await service.toggleMenuItemAvailability('item-1', false);

      expect(result.available).toBe(false);
    });

    it('throws when toggle fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Toggle failed' } })
      );

      await expect(service.toggleMenuItemAvailability('bad-item', true)).rejects.toThrow(
        'Failed to toggle item availability: Toggle failed'
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

      // 1st call: query vendor_menu_items → vendor_ids
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
      // 3rd call: vendor_menu_items (filtered by allowed vendor IDs)
      const itemsMock = createSupabaseMock({
        data: [{ vendor_id: 'v1' }],
        error: null,
      });
      // 4th call: fetch vendors
      const vendorsMock = createSupabaseMock({
        data: [makeVendor({ id: 'v1' })],
        error: null,
      });

      mockFromSequence([eventMock, eventVendorsMock, itemsMock, vendorsMock]);

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
        'vendor:vendor-123:menu',
        'vendor:vendor-123:stats'
      );
    });
  });
});
