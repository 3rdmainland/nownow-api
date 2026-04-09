import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';
import { makeEvent } from '../fixtures/index.js';

// ── Module mocks (must be declared before any imports that use them) ──────────

// event.service.ts imports without .js extension; mock both forms for safety
vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));

vi.mock('../../lib/redis', () => ({
  default: redisMock,
  cache: cacheMock,
  CACHE_TTL: CACHE_TTL_MOCK,
}));

vi.mock('../../lib/redis.js', () => ({
  default: redisMock,
  cache: cacheMock,
  CACHE_TTL: CACHE_TTL_MOCK,
}));

// Import after mocks
import { EventService } from '../../event/event.service.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wire up supabaseMock.from to return different responses for sequential calls.
 * Each element is consumed in order as supabase.from() is invoked.
 */
function mockFromSequence(responses: Array<ReturnType<typeof createSupabaseMock>>) {
  let callIndex = 0;
  supabaseMock.from.mockImplementation(() => {
    const response = responses[callIndex] ?? createSupabaseMock({ data: null, error: null });
    callIndex++;
    return response;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EventService', () => {
  let service: EventService;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheMock.get.mockResolvedValue(null);
    cacheMock.set.mockResolvedValue(undefined);
    cacheMock.del.mockResolvedValue(undefined);
    service = new EventService();
  });

  // ── getAllEvents ─────────────────────────────────────────────────────────────

  describe('getAllEvents', () => {
    it('returns an array of mapped events when records exist', async () => {
      const dbEvent1 = makeEvent({ name: 'Summer Fest', code: 'SUMFEST' });
      const dbEvent2 = makeEvent({ name: 'Winter Gala', code: 'WINGAL' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [dbEvent1, dbEvent2], error: null }),
      );

      const events = await service.getAllEvents();

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        name: 'Summer Fest',
        code: 'SUMFEST',
        status: 'ACTIVE',
      });
      expect(events[1]).toMatchObject({
        name: 'Winter Gala',
        code: 'WINGAL',
      });
    });

    it('returns an empty array when no events exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const events = await service.getAllEvents();

      expect(events).toEqual([]);
    });

    it('returns an empty array when data is null', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const events = await service.getAllEvents();

      expect(events).toEqual([]);
    });

    it('throws an error when the database query fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'connection refused' } }),
      );

      await expect(service.getAllEvents()).rejects.toThrow(
        'Failed to fetch events: connection refused',
      );
    });

    it('correctly maps snake_case DB fields to camelCase Event fields', async () => {
      const now = new Date().toISOString();
      const dbEvent = makeEvent({
        start_date: now,
        end_date: now,
        image_url: 'https://cdn.test/img.jpg',
        is_public: false,
        created_at: now,
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [dbEvent], error: null }),
      );

      const [event] = await service.getAllEvents();

      expect(event.startDate).toBe(now);
      expect(event.endDate).toBe(now);
      expect(event.imageUrl).toBe('https://cdn.test/img.jpg');
      expect(event.isPublic).toBe(false);
      expect(event.created_at).toBe(now);
    });
  });

  // ── getEventById ─────────────────────────────────────────────────────────────

  describe('getEventById', () => {
    it('returns the mapped event when found', async () => {
      const dbEvent = makeEvent({ id: 'event-uuid-001', name: 'Found Event' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbEvent, error: null }),
      );

      const event = await service.getEventById('event-uuid-001');

      expect(event).not.toBeNull();
      expect(event!.id).toBe('event-uuid-001');
      expect(event!.name).toBe('Found Event');
    });

    it('returns null when no event matches the given id', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const event = await service.getEventById('does-not-exist');

      expect(event).toBeNull();
    });

    it('throws an error when the database query fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'timeout' } }),
      );

      await expect(service.getEventById('any-id')).rejects.toThrow(
        'Failed to fetch event: timeout',
      );
    });
  });

  // ── getEventByCode ───────────────────────────────────────────────────────────

  describe('getEventByCode', () => {
    it('returns the mapped event when a matching code exists', async () => {
      const dbEvent = makeEvent({ code: 'TECHCONF2026', name: 'Tech Conference' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbEvent, error: null }),
      );

      const event = await service.getEventByCode('TECHCONF2026');

      expect(event).not.toBeNull();
      expect(event!.code).toBe('TECHCONF2026');
      expect(event!.name).toBe('Tech Conference');
    });

    it('returns null when no event matches the given code', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows found' } }),
      );

      const event = await service.getEventByCode('UNKNOWN');

      expect(event).toBeNull();
    });

    it('returns null when data is null and there is no error', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const event = await service.getEventByCode('MISSING');

      expect(event).toBeNull();
    });
  });

  // ── createEvent ──────────────────────────────────────────────────────────────

  describe('createEvent', () => {
    it('inserts a new event and returns the mapped result with ACTIVE status', async () => {
      const insertedDbEvent = makeEvent({
        id: 'new-event-id',
        name: 'Brand New Event',
        code: 'NEWEV',
        status: 'ACTIVE',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: insertedDbEvent, error: null }),
      );

      const input = {
        name: 'Brand New Event',
        code: 'NEWEV',
        startDate: new Date(Date.now() + 86400000).toISOString(),
        endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
        location: {
          latitude: -33.9249,
          longitude: 18.4241,
          address: '1 Convention Square',
          city: 'Cape Town',
          state: 'WC',
          zipCode: '8001',
        },
        isPublic: true,
        vendorIds: [],
      };

      const event = await service.createEvent(input);

      expect(event).toMatchObject({
        id: 'new-event-id',
        name: 'Brand New Event',
        code: 'NEWEV',
        status: 'ACTIVE',
      });
      // vendorIds is always initialised as empty array by fromDbEvent
      expect(event.vendorIds).toEqual([]);
    });

    it('throws an error when the database insert fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'unique constraint violated' } }),
      );

      const input = {
        name: 'Duplicate Event',
        code: 'DUP',
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        location: {
          latitude: 0,
          longitude: 0,
          address: 'Addr',
          city: 'City',
          state: 'ST',
          zipCode: '0000',
        },
        isPublic: true,
        vendorIds: [],
      };

      await expect(service.createEvent(input)).rejects.toThrow(
        'Failed to create event: unique constraint violated',
      );
    });
  });

  // ── updateEvent ──────────────────────────────────────────────────────────────

  describe('updateEvent', () => {
    it('returns the updated event on success', async () => {
      const updatedDbEvent = makeEvent({
        id: 'event-to-update',
        name: 'Updated Name',
        status: 'ACTIVE',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: updatedDbEvent, error: null }),
      );

      const event = await service.updateEvent('event-to-update', { name: 'Updated Name', status: 'ACTIVE' });

      expect(event).toMatchObject({
        id: 'event-to-update',
        name: 'Updated Name',
        status: 'ACTIVE',
      });
    });

    it('throws an error when the event does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows found' } }),
      );

      await expect(
        service.updateEvent('nonexistent-event', { name: 'Ghost' }),
      ).rejects.toThrow('Failed to update event');
    });
  });

  // ── deleteEvent ──────────────────────────────────────────────────────────────

  describe('deleteEvent', () => {
    it('resolves without error on successful deletion', async () => {
      const existingEvent = makeEvent({ id: 'event-id-to-delete', code: 'DEL01' });

      mockFromSequence([
        // 1st call: getEventById → select from events
        createSupabaseMock({ data: existingEvent, error: null }),
        // 2nd call: getEventById → populateVendorIds from event_vendors
        createSupabaseMock({ data: [], error: null }),
        // 3rd call: delete from events
        createSupabaseMock({ data: null, error: null }),
      ]);

      await expect(service.deleteEvent('event-id-to-delete')).resolves.toBeUndefined();
    });

    it('throws an error when the deletion fails', async () => {
      const existingEvent = makeEvent({ id: 'locked-event-id', code: 'LOCKED' });

      mockFromSequence([
        // 1st call: getEventById → select from events (succeeds)
        createSupabaseMock({ data: existingEvent, error: null }),
        // 2nd call: getEventById → populateVendorIds from event_vendors
        createSupabaseMock({ data: [], error: null }),
        // 3rd call: delete from events (fails)
        createSupabaseMock({ data: null, error: { message: 'foreign key violation' } }),
      ]);

      await expect(service.deleteEvent('locked-event-id')).rejects.toThrow(
        'Failed to delete event: foreign key violation',
      );
    });
  });

  // ── addVendorsToEvent ─────────────────────────────────────────────────────────

  describe('inviteVendorsToEvent', () => {
    const fakeEvent = { id: 'event-abc', organizer_id: 'org-1', start_date: '2026-04-01' };

    it('upserts junction and agreement records on success', async () => {
      let callCount = 0;
      supabaseMock.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // fetch event
          return createSupabaseMock({ data: fakeEvent, error: null });
        }
        return createSupabaseMock({ data: null, error: null });
      });

      await expect(
        service.inviteVendorsToEvent('event-abc', 'org-1', [
          { vendorId: 'vendor-1', commissionRate: 10 },
        ]),
      ).resolves.toBeUndefined();

      expect(supabaseMock.from).toHaveBeenCalledWith('events');
      expect(supabaseMock.from).toHaveBeenCalledWith('event_vendors');
      expect(supabaseMock.from).toHaveBeenCalledWith('organizer_vendor_agreements');
      expect(cacheMock.del).toHaveBeenCalled();
    });

    it('throws when commission rate is out of range', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: fakeEvent, error: null }),
      );

      await expect(
        service.inviteVendorsToEvent('event-abc', 'org-1', [
          { vendorId: 'vendor-1', commissionRate: 60 },
        ]),
      ).rejects.toThrow('Commission rate must be between 0% and 50%');
    });

    it('throws when the event_vendors upsert fails', async () => {
      let callCount = 0;
      supabaseMock.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createSupabaseMock({ data: fakeEvent, error: null });
        }
        return createSupabaseMock({ data: null, error: { message: 'upsert failed' } });
      });

      await expect(
        service.inviteVendorsToEvent('event-abc', 'org-1', [
          { vendorId: 'vendor-id', commissionRate: 5 },
        ]),
      ).rejects.toThrow('Failed to invite vendors to event: upsert failed');
    });
  });

  // ── removeVendorFromEvent ─────────────────────────────────────────────────────

  describe('removeVendorFromEvent', () => {
    it('removes the junction record and invalidates the cache on success', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      await expect(
        service.removeVendorFromEvent('event-123', 'vendor-456'),
      ).resolves.toBeUndefined();

      expect(supabaseMock.from).toHaveBeenCalledWith('event_vendors');
      expect(cacheMock.del).toHaveBeenCalled();
    });

    it('throws when the deletion fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'row not found' } }),
      );

      await expect(
        service.removeVendorFromEvent('event-id', 'vendor-id'),
      ).rejects.toThrow('Failed to remove vendor from event: row not found');
    });
  });

  // ── getEventsByVendorId ───────────────────────────────────────────────────────

  describe('getEventsByVendorId', () => {
    it('returns all events for a vendor including menu configuration status', async () => {
      const dbEvent = makeEvent({ id: 'ev-001', name: 'Vendor Event' });

      const eventVendorsResponse = createSupabaseMock({
        data: [{ events: dbEvent }],
        error: null,
      });

      const menuConfigResponse = createSupabaseMock({
        data: [{ event_id: 'ev-001', status: 'PUBLISHED' }],
        error: null,
      });

      mockFromSequence([eventVendorsResponse, menuConfigResponse]);

      const events = await service.getEventsByVendorId('vendor-xyz');

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('ev-001');
      expect(events[0].menuStatus).toBe('PUBLISHED');
    });

    it('sets menuStatus to DRAFT when configuration exists but is not published', async () => {
      const dbEvent = makeEvent({ id: 'ev-002' });

      mockFromSequence([
        createSupabaseMock({ data: [{ events: dbEvent }], error: null }),
        createSupabaseMock({ data: [{ event_id: 'ev-002', status: 'DRAFT' }], error: null }),
      ]);

      const events = await service.getEventsByVendorId('vendor-abc');

      expect(events[0].menuStatus).toBe('DRAFT');
    });

    it('sets menuStatus to NOT_CONFIGURED when no menu config exists for that event', async () => {
      const dbEvent = makeEvent({ id: 'ev-003' });

      mockFromSequence([
        createSupabaseMock({ data: [{ events: dbEvent }], error: null }),
        // No matching config for ev-003
        createSupabaseMock({ data: [], error: null }),
      ]);

      const events = await service.getEventsByVendorId('vendor-def');

      expect(events[0].menuStatus).toBe('NOT_CONFIGURED');
    });

    it('returns an empty array and skips the menu config query when no events are found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const events = await service.getEventsByVendorId('vendor-no-events');

      expect(events).toEqual([]);
      // from should have been called exactly once (for event_vendors only)
      expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    });

    it('applies the activeOnly GTE filter when activeOnly is true', async () => {
      const mockBuilder = createSupabaseMock({ data: [], error: null });
      supabaseMock.from.mockReturnValue(mockBuilder);

      await service.getEventsByVendorId('vendor-active', true);

      expect(mockBuilder.gte).toHaveBeenCalledWith('events.end_date', expect.any(String));
    });

    it('does not apply the GTE filter when activeOnly is false (default)', async () => {
      const mockBuilder = createSupabaseMock({ data: [], error: null });
      supabaseMock.from.mockReturnValue(mockBuilder);

      await service.getEventsByVendorId('vendor-all');

      expect(mockBuilder.gte).not.toHaveBeenCalled();
    });

    it('filters out null event entries from the joined result', async () => {
      const dbEvent = makeEvent({ id: 'ev-valid' });

      mockFromSequence([
        createSupabaseMock({ data: [{ events: dbEvent }, { events: null }], error: null }),
        createSupabaseMock({ data: [], error: null }),
      ]);

      const events = await service.getEventsByVendorId('vendor-ghi');

      // Only the non-null event should be included
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('ev-valid');
    });

    it('throws an error when the database query fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'query error' } }),
      );

      await expect(service.getEventsByVendorId('vendor-err')).rejects.toThrow(
        'Failed to fetch events for vendor: query error',
      );
    });
  });
});
