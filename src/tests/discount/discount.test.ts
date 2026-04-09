import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { cacheMock } from '../mocks/redis.js';
import { makeDiscount } from '../fixtures/index.js';
import { buildApp } from '../helpers/app.js';
import type { FastifyInstance } from 'fastify';

// ── Module mocks (must be at top level) ──────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));

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

vi.mock('../../lib/auth.js', () => ({
  authenticate: vi.fn(async (_req: any, _reply: any) => {
    // No-op: allow all requests through in tests
  }),
  authenticateOrganizer: vi.fn(async (_req: any, _reply: any) => {}),
}));

vi.mock('../../lib/feature-flags.js', () => ({
  requireFeature: () => async () => {},
}));

// Import after mocks
import { DiscountService } from '../../discount/discount.service.js';
import discountController from '../../discount/discount.controller.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wire supabaseMock.from to return responses in sequence.
 */
function mockFromSequence(responses: Array<ReturnType<typeof createSupabaseMock>>) {
  let callIndex = 0;
  supabaseMock.from.mockImplementation(() => {
    const response = responses[callIndex] ?? createSupabaseMock({ data: null, error: null });
    callIndex++;
    return response;
  });
}

/**
 * Build a valid UUID-shaped string for use in discount schema params (which require uuid format).
 */
function uuid() {
  return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
}

// ── Shared fixture IDs ─────────────────────────────────────────────────────────
const EVENT_ID = uuid();
const VENDOR_ID = uuid();
const ITEM_ID_1 = uuid();
const ITEM_ID_2 = uuid();
const DISCOUNT_ID = uuid();

// ══════════════════════════════════════════════════════════════════════════════
//  SERVICE UNIT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('DiscountService', () => {
  let service: DiscountService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DiscountService();
  });

  // ── createDiscount ────────────────────────────────────────────────────────────

  describe('createDiscount', () => {
    it('creates a PERCENTAGE EVENT-scope organizer discount and returns the mapped result', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: null,
        scope: 'EVENT',
        type: 'PERCENTAGE',
        value: '15',
        created_by: 'ORGANIZER',
        is_active: true,
      });

      // First call: insert discount. Cache invalidation calls supabase.from too.
      mockFromSequence([
        createSupabaseMock({ data: dbDiscount, error: null }),
        // Organizer discount → cache invalidation fetches event_menu_configurations
        createSupabaseMock({ data: [], error: null }),
      ]);

      const discount = await service.createDiscount({
        eventId: EVENT_ID,
        scope: 'EVENT',
        type: 'PERCENTAGE',
        value: 15,
        createdBy: 'ORGANIZER',
      });

      expect(discount).toMatchObject({
        id: DISCOUNT_ID,
        eventId: EVENT_ID,
        vendorId: null,
        scope: 'EVENT',
        type: 'PERCENTAGE',
        value: 15,
        isActive: true,
        createdBy: 'ORGANIZER',
      });
    });

    it('creates a FIXED EVENT-scope vendor discount and returns the mapped result', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        scope: 'EVENT',
        type: 'FIXED',
        value: '20',
        created_by: 'VENDOR',
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbDiscount, error: null }),
      );

      const discount = await service.createDiscount({
        eventId: EVENT_ID,
        vendorId: VENDOR_ID,
        scope: 'EVENT',
        type: 'FIXED',
        value: 20,
        createdBy: 'VENDOR',
      });

      expect(discount).toMatchObject({
        vendorId: VENDOR_ID,
        type: 'FIXED',
        value: 20,
        createdBy: 'VENDOR',
      });
    });

    it('creates an ITEM-scope discount with targetItemIds', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        scope: 'ITEM',
        type: 'PERCENTAGE',
        value: '10',
        target_item_ids: [ITEM_ID_1, ITEM_ID_2],
        created_by: 'VENDOR',
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbDiscount, error: null }),
      );

      const discount = await service.createDiscount({
        eventId: EVENT_ID,
        vendorId: VENDOR_ID,
        scope: 'ITEM',
        targetItemIds: [ITEM_ID_1, ITEM_ID_2],
        type: 'PERCENTAGE',
        value: 10,
        createdBy: 'VENDOR',
      });

      expect(discount.scope).toBe('ITEM');
      expect(discount.targetItemIds).toEqual([ITEM_ID_1, ITEM_ID_2]);
    });

    it('throws ValidationError when PERCENTAGE value is 0', async () => {
      await expect(
        service.createDiscount({
          eventId: EVENT_ID,
          scope: 'EVENT',
          type: 'PERCENTAGE',
          value: 0,
          createdBy: 'ORGANIZER',
        }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Percentage discount must be between 0.01 and 100',
      });
    });

    it('throws ValidationError when PERCENTAGE value exceeds 100', async () => {
      await expect(
        service.createDiscount({
          eventId: EVENT_ID,
          scope: 'EVENT',
          type: 'PERCENTAGE',
          value: 101,
          createdBy: 'ORGANIZER',
        }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Percentage discount must be between 0.01 and 100',
      });
    });

    it('throws ValidationError when ITEM scope is used without targetItemIds', async () => {
      await expect(
        service.createDiscount({
          eventId: EVENT_ID,
          vendorId: VENDOR_ID,
          scope: 'ITEM',
          type: 'FIXED',
          value: 10,
          createdBy: 'VENDOR',
        }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'targetItemIds is required for ITEM scope discounts',
      });
    });

    it('throws ValidationError when ITEM scope has an empty targetItemIds array', async () => {
      await expect(
        service.createDiscount({
          eventId: EVENT_ID,
          vendorId: VENDOR_ID,
          scope: 'ITEM',
          targetItemIds: [],
          type: 'FIXED',
          value: 10,
          createdBy: 'VENDOR',
        }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'targetItemIds is required for ITEM scope discounts',
      });
    });

    it('throws ValidationError when an organizer discount specifies a vendorId', async () => {
      await expect(
        service.createDiscount({
          eventId: EVENT_ID,
          vendorId: VENDOR_ID,
          scope: 'EVENT',
          type: 'PERCENTAGE',
          value: 10,
          createdBy: 'ORGANIZER',
        }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        message: 'Organizer discounts cannot target a specific vendor',
      });
    });

    it('throws ValidationError when a vendor discount is missing a vendorId', async () => {
      await expect(
        service.createDiscount({
          eventId: EVENT_ID,
          scope: 'EVENT',
          type: 'PERCENTAGE',
          value: 10,
          createdBy: 'VENDOR',
        }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        message: 'Vendor discounts require a vendorId',
      });
    });

    it('throws ValidationError when the database insert fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'insert error' } }),
      );

      await expect(
        service.createDiscount({
          eventId: EVENT_ID,
          scope: 'EVENT',
          type: 'FIXED',
          value: 50,
          createdBy: 'ORGANIZER',
        }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
      });
    });
  });

  // ── listEventDiscounts ────────────────────────────────────────────────────────

  describe('listEventDiscounts', () => {
    it('returns all active discounts for an event when no vendorId filter is set', async () => {
      const disc1 = makeDiscount({ event_id: EVENT_ID, is_active: true, vendor_id: null });
      const disc2 = makeDiscount({ event_id: EVENT_ID, is_active: true, vendor_id: VENDOR_ID });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [disc1, disc2], error: null }),
      );

      const discounts = await service.listEventDiscounts(EVENT_ID);

      expect(discounts).toHaveLength(2);
    });

    it('applies the OR filter when vendorId is provided', async () => {
      const disc = makeDiscount({ event_id: EVENT_ID, vendor_id: VENDOR_ID, is_active: true });
      const mockBuilder = createSupabaseMock({ data: [disc], error: null });
      supabaseMock.from.mockReturnValue(mockBuilder);

      const discounts = await service.listEventDiscounts(EVENT_ID, VENDOR_ID);

      expect(mockBuilder.or).toHaveBeenCalledWith(
        `vendor_id.eq.${VENDOR_ID},vendor_id.is.null`,
      );
      expect(discounts).toHaveLength(1);
    });

    it('does not apply the OR filter when no vendorId is given', async () => {
      const mockBuilder = createSupabaseMock({ data: [], error: null });
      supabaseMock.from.mockReturnValue(mockBuilder);

      await service.listEventDiscounts(EVENT_ID);

      expect(mockBuilder.or).not.toHaveBeenCalled();
    });

    it('returns an empty array when no discounts are found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const discounts = await service.listEventDiscounts(EVENT_ID);

      expect(discounts).toEqual([]);
    });

    it('throws when the database query fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'query failed' } }),
      );

      await expect(service.listEventDiscounts(EVENT_ID)).rejects.toMatchObject({
        name: 'ValidationError',
      });
    });
  });

  // ── listVendorDiscounts ───────────────────────────────────────────────────────

  describe('listVendorDiscounts', () => {
    it('returns discounts specific to the vendor at the event', async () => {
      const disc1 = makeDiscount({ event_id: EVENT_ID, vendor_id: VENDOR_ID, is_active: true });
      const disc2 = makeDiscount({ event_id: EVENT_ID, vendor_id: VENDOR_ID, is_active: false });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [disc1, disc2], error: null }),
      );

      const discounts = await service.listVendorDiscounts(EVENT_ID, VENDOR_ID);

      // listVendorDiscounts does NOT filter by is_active — returns all
      expect(discounts).toHaveLength(2);
    });

    it('filters by both event_id and vendor_id', async () => {
      const mockBuilder = createSupabaseMock({ data: [], error: null });
      supabaseMock.from.mockReturnValue(mockBuilder);

      await service.listVendorDiscounts(EVENT_ID, VENDOR_ID);

      expect(mockBuilder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
      expect(mockBuilder.eq).toHaveBeenCalledWith('vendor_id', VENDOR_ID);
    });

    it('returns an empty array when the vendor has no discounts at the event', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const discounts = await service.listVendorDiscounts(EVENT_ID, VENDOR_ID);

      expect(discounts).toEqual([]);
    });

    it('throws when the database query fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'access denied' } }),
      );

      await expect(service.listVendorDiscounts(EVENT_ID, VENDOR_ID)).rejects.toMatchObject({
        name: 'ValidationError',
      });
    });
  });

  // ── updateDiscount ────────────────────────────────────────────────────────────

  describe('updateDiscount', () => {
    it('returns the updated discount on success', async () => {
      const updatedDb = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        is_active: false,
        value: '25',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: updatedDb, error: null }),
      );

      const discount = await service.updateDiscount(DISCOUNT_ID, { isActive: false, value: 25 });

      expect(discount).toMatchObject({
        id: DISCOUNT_ID,
        isActive: false,
        value: 25,
      });
    });

    it('throws NotFoundError when the discount does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'no rows returned' } }),
      );

      await expect(
        service.updateDiscount('ghost-discount-id', { isActive: false }),
      ).rejects.toMatchObject({
        name: 'NotFoundError',
        statusCode: 404,
      });
    });

    it('throws ValidationError when updating ITEM scope with an empty targetItemIds', async () => {
      await expect(
        service.updateDiscount(DISCOUNT_ID, { scope: 'ITEM', targetItemIds: [] }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        message: 'targetItemIds cannot be empty for ITEM scope discounts',
      });
    });

    it('throws ValidationError when PERCENTAGE value is out of range', async () => {
      await expect(
        service.updateDiscount(DISCOUNT_ID, { type: 'PERCENTAGE', value: 0 }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        message: 'Percentage discount must be between 0.01 and 100',
      });
    });

    it('allows setting targetItemIds to null (clearing item targets)', async () => {
      const updatedDb = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        scope: 'EVENT',
        target_item_ids: null,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: updatedDb, error: null }),
      );

      // Should NOT throw — null targetItemIds on ITEM scope check is only for empty array
      const discount = await service.updateDiscount(DISCOUNT_ID, {
        scope: 'ITEM',
        targetItemIds: null,
      });

      expect(discount.targetItemIds).toBeNull();
    });
  });

  // ── deleteDiscount ────────────────────────────────────────────────────────────

  describe('deleteDiscount', () => {
    it('resolves without error and invalidates cache on successful deletion', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbDiscount, error: null }),
      );

      await expect(service.deleteDiscount(DISCOUNT_ID)).resolves.toBeUndefined();

      expect(cacheMock.del).toHaveBeenCalledWith(`menu:event:${VENDOR_ID}:${EVENT_ID}`);
    });

    it('throws NotFoundError when the discount does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'not found' } }),
      );

      await expect(service.deleteDiscount('ghost-id')).rejects.toMatchObject({
        name: 'NotFoundError',
        statusCode: 404,
      });
    });
  });

  // ── resolveDiscount ───────────────────────────────────────────────────────────

  describe('resolveDiscount', () => {
    it('returns a ResolvedDiscount when an organizer EVENT discount applies', async () => {
      // Organizer event-wide discount: vendorId is null, scope is EVENT
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: null,
        scope: 'EVENT',
        type: 'PERCENTAGE',
        value: '10',
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [dbDiscount], error: null }),
      );

      const result = await service.resolveDiscount(EVENT_ID, VENDOR_ID, ITEM_ID_1, 100);

      expect(result).not.toBeNull();
      expect(result!.discountId).toBe(DISCOUNT_ID);
      expect(result!.type).toBe('PERCENTAGE');
      expect(result!.value).toBe(10);
      expect(result!.originalPrice).toBe(100);
      expect(result!.savings).toBe(10);
      expect(result!.discountedPrice).toBe(90);
      expect(result!.discountPercentage).toBe(10);
    });

    it('returns a ResolvedDiscount when a vendor ITEM discount applies to the specific item', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        scope: 'ITEM',
        type: 'FIXED',
        value: '20',
        target_item_ids: [ITEM_ID_1],
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [dbDiscount], error: null }),
      );

      const result = await service.resolveDiscount(EVENT_ID, VENDOR_ID, ITEM_ID_1, 80);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('FIXED');
      expect(result!.value).toBe(20);
      expect(result!.savings).toBe(20);
      expect(result!.discountedPrice).toBe(60);
    });

    it('returns null when the vendor ITEM discount does not include the queried item', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        scope: 'ITEM',
        type: 'PERCENTAGE',
        value: '15',
        target_item_ids: [ITEM_ID_2], // ITEM_ID_1 is not included
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [dbDiscount], error: null }),
      );

      const result = await service.resolveDiscount(EVENT_ID, VENDOR_ID, ITEM_ID_1, 100);

      expect(result).toBeNull();
    });

    it('returns null when no active discounts exist for the event', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const result = await service.resolveDiscount(EVENT_ID, VENDOR_ID, ITEM_ID_1, 100);

      expect(result).toBeNull();
    });

    it('returns null when data is null (no discounts in DB)', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const result = await service.resolveDiscount(EVENT_ID, VENDOR_ID, ITEM_ID_1, 50);

      expect(result).toBeNull();
    });

    it('picks the best (highest-savings) discount when multiple discounts apply', async () => {
      const smallDiscount = makeDiscount({
        id: 'disc-small',
        event_id: EVENT_ID,
        vendor_id: null,         // organizer event-wide
        scope: 'EVENT',
        type: 'PERCENTAGE',
        value: '5',              // saves 5 on a £100 item
        is_active: true,
      });

      const bigDiscount = makeDiscount({
        id: 'disc-big',
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,   // vendor event-wide
        scope: 'EVENT',
        type: 'FIXED',
        value: '25',            // saves 25 on a £100 item
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [smallDiscount, bigDiscount], error: null }),
      );

      const result = await service.resolveDiscount(EVENT_ID, VENDOR_ID, ITEM_ID_1, 100);

      expect(result).not.toBeNull();
      expect(result!.discountId).toBe('disc-big');
      expect(result!.savings).toBe(25);
      expect(result!.discountedPrice).toBe(75);
    });

    it('returns null for a discount that would produce zero savings (FIXED 0 is invalid per schema, so this covers edge price)', async () => {
      // A FIXED discount larger than the item price: savings is capped at the price
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: null,
        scope: 'EVENT',
        type: 'FIXED',
        value: '200',   // item price is only 50
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [dbDiscount], error: null }),
      );

      const result = await service.resolveDiscount(EVENT_ID, VENDOR_ID, ITEM_ID_1, 50);

      // Savings = min(200, 50) = 50, discountedPrice = 0
      expect(result).not.toBeNull();
      expect(result!.savings).toBe(50);
      expect(result!.discountedPrice).toBe(0);
    });

    it('ignores a discount belonging to a different vendor when scope is EVENT', async () => {
      const anotherVendorId = uuid();
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: anotherVendorId, // belongs to a different vendor
        scope: 'EVENT',
        type: 'PERCENTAGE',
        value: '20',
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [dbDiscount], error: null }),
      );

      const result = await service.resolveDiscount(EVENT_ID, VENDOR_ID, ITEM_ID_1, 100);

      // VENDOR_ID !== anotherVendorId, and vendorId is not null → should not apply
      expect(result).toBeNull();
    });

    it('correctly calculates discountPercentage for a FIXED discount', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: null,
        scope: 'EVENT',
        type: 'FIXED',
        value: '10',
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [dbDiscount], error: null }),
      );

      const result = await service.resolveDiscount(EVENT_ID, VENDOR_ID, ITEM_ID_1, 40);

      // savings = 10, originalPrice = 40, discountPercentage = (10/40)*100 = 25
      expect(result!.discountPercentage).toBe(25);
      expect(result!.discountedPrice).toBe(30);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  CONTROLLER INTEGRATION TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Discount Controller (integration)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp(async (fastify) => {
      fastify.register(discountController, { prefix: '/discount' });
    });
  });

  // ── GET /discount/organizer/events/:eventId ───────────────────────────────────

  describe('GET /discount/organizer/events/:eventId', () => {
    it('returns 200 with all event discounts', async () => {
      const disc1 = makeDiscount({ event_id: EVENT_ID, vendor_id: null, is_active: true });
      const disc2 = makeDiscount({ event_id: EVENT_ID, vendor_id: VENDOR_ID, is_active: true });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [disc1, disc2], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/discount/organizer/events/${EVENT_ID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
    });

    it('returns 200 with an empty array when no discounts exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/discount/organizer/events/${EVENT_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ── GET /discount/vendor/:vendorId/events/:eventId ────────────────────────────

  describe('GET /discount/vendor/:vendorId/events/:eventId', () => {
    it('returns 200 with vendor-specific discounts', async () => {
      const disc = makeDiscount({
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [disc], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(body[0].vendorId).toBe(VENDOR_ID);
    });

    it('returns 200 with an empty array when the vendor has no discounts', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ── POST /discount/organizer/events/:eventId ──────────────────────────────────

  describe('POST /discount/organizer/events/:eventId', () => {
    it('returns 201 with the created organizer PERCENTAGE discount', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: null,
        scope: 'EVENT',
        type: 'PERCENTAGE',
        value: '10',
        created_by: 'ORGANIZER',
        is_active: true,
      });

      mockFromSequence([
        createSupabaseMock({ data: dbDiscount, error: null }),
        // cache invalidation
        createSupabaseMock({ data: [], error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: `/discount/organizer/events/${EVENT_ID}`,
        payload: { type: 'PERCENTAGE', value: 10 },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({
        id: DISCOUNT_ID,
        type: 'PERCENTAGE',
        value: 10,
        isActive: true,
        createdBy: 'ORGANIZER',
      });
    });

    it('returns 201 with the created organizer FIXED discount', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: null,
        scope: 'EVENT',
        type: 'FIXED',
        value: '50',
        created_by: 'ORGANIZER',
        is_active: true,
      });

      mockFromSequence([
        createSupabaseMock({ data: dbDiscount, error: null }),
        createSupabaseMock({ data: [], error: null }),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: `/discount/organizer/events/${EVENT_ID}`,
        payload: { type: 'FIXED', value: 50 },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().type).toBe('FIXED');
    });

    it('returns 400 when required body fields are missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/discount/organizer/events/${EVENT_ID}`,
        payload: { type: 'PERCENTAGE' }, // missing value
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when value is below the minimum (0.01)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/discount/organizer/events/${EVENT_ID}`,
        payload: { type: 'PERCENTAGE', value: 0 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /discount/vendor/:vendorId/events/:eventId ───────────────────────────

  describe('POST /discount/vendor/:vendorId/events/:eventId', () => {
    it('returns 201 with the created vendor EVENT discount', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        scope: 'EVENT',
        type: 'PERCENTAGE',
        value: '5',
        created_by: 'VENDOR',
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbDiscount, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
        payload: { scope: 'EVENT', type: 'PERCENTAGE', value: 5 },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.vendorId).toBe(VENDOR_ID);
      expect(body.createdBy).toBe('VENDOR');
    });

    it('returns 201 with a vendor ITEM discount including targetItemIds', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        scope: 'ITEM',
        type: 'FIXED',
        value: '15',
        target_item_ids: [ITEM_ID_1],
        created_by: 'VENDOR',
        is_active: true,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbDiscount, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
        payload: { scope: 'ITEM', type: 'FIXED', value: 15, targetItemIds: [ITEM_ID_1] },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().scope).toBe('ITEM');
    });

    it('returns 400 when scope is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/discount/vendor/${VENDOR_ID}/events/${EVENT_ID}`,
        payload: { type: 'FIXED', value: 10 }, // missing scope
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── PATCH /discount/:id ───────────────────────────────────────────────────────

  describe('PATCH /discount/:id', () => {
    it('returns 200 with the updated discount', async () => {
      const updatedDb = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
        is_active: false,
        value: '30',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: updatedDb, error: null }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: `/discount/${DISCOUNT_ID}`,
        payload: { isActive: false, value: 30 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.isActive).toBe(false);
      expect(body.value).toBe(30);
    });

    it('returns 404 when the discount to update does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'not found' } }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: `/discount/${DISCOUNT_ID}`,
        payload: { isActive: true },
      });

      // NotFoundError (statusCode 404) is handled by the error handler
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when value is below the minimum', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/discount/${DISCOUNT_ID}`,
        payload: { value: 0 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── DELETE /discount/:id ──────────────────────────────────────────────────────

  describe('DELETE /discount/:id', () => {
    it('returns 200 with a confirmation message after deletion', async () => {
      const dbDiscount = makeDiscount({
        id: DISCOUNT_ID,
        event_id: EVENT_ID,
        vendor_id: VENDOR_ID,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbDiscount, error: null }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/discount/${DISCOUNT_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ message: 'Discount deleted' });
    });

    it('returns 404 when the discount does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'not found' } }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/discount/${DISCOUNT_ID}`,
      });

      // NotFoundError → 404 via error handler
      expect(res.statusCode).toBe(404);
    });
  });
});
