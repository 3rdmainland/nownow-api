import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';
import { makeEvent } from '../fixtures/index.js';
import { buildApp } from '../helpers/app.js';
import type { FastifyInstance } from 'fastify';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock }));
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }));

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
import eventController from '../../event/event.controller.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wire up supabaseMock.from to return different responses for sequential calls.
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

describe('Event Controller (integration)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp(async (fastify) => {
      fastify.register(eventController, { prefix: '/event' });
    });
  });

  // ── GET /event ────────────────────────────────────────────────────────────────

  describe('GET /event', () => {
    it('returns 200 with an events array', async () => {
      const dbEvent = makeEvent({ name: 'Festival One', code: 'FEST1' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [dbEvent], error: null }),
      );

      const res = await app.inject({ method: 'GET', url: '/event' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('events');
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.events).toHaveLength(1);
      expect(body.events[0].name).toBe('Festival One');
    });

    it('returns 200 with an empty events array when no events exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({ method: 'GET', url: '/event' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ events: [] });
    });

    it('returns 500 when the service throws', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'db error' } }),
      );

      const res = await app.inject({ method: 'GET', url: '/event' });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toHaveProperty('error');
    });
  });

  // ── GET /event/code/:code ─────────────────────────────────────────────────────

  describe('GET /event/code/:code', () => {
    it('returns 200 with the event when the code exists', async () => {
      const dbEvent = makeEvent({ code: 'SUMMERFEST', name: 'Summer Festival' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbEvent, error: null }),
      );

      const res = await app.inject({ method: 'GET', url: '/event/code/SUMMERFEST' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('event');
      expect(body.event.code).toBe('SUMMERFEST');
      expect(body.event.name).toBe('Summer Festival');
    });

    it('returns 404 when no event matches the code', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'not found' } }),
      );

      const res = await app.inject({ method: 'GET', url: '/event/code/NONEXISTENT' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Event not found' });
    });

    it('returns 500 when the service throws unexpectedly', async () => {
      // Simulate a DB connectivity error (non-null error on the builder triggers throw in getEventById but getEventByCode swallows it)
      // We force an uncaught throw by making .single throw instead
      const brokenBuilder = createSupabaseMock({ data: null, error: null });
      (brokenBuilder.single as any).mockRejectedValueOnce(new Error('network error'));
      supabaseMock.from.mockReturnValue(brokenBuilder);

      const res = await app.inject({ method: 'GET', url: '/event/code/BOOM' });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /event/:id ────────────────────────────────────────────────────────────

  describe('GET /event/:id', () => {
    it('returns 200 with the event when found', async () => {
      const dbEvent = makeEvent({ id: 'ev-known-id', name: 'Known Event' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbEvent, error: null }),
      );

      const res = await app.inject({ method: 'GET', url: '/event/ev-known-id' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.event.id).toBe('ev-known-id');
      expect(body.event.name).toBe('Known Event');
    });

    it('returns 404 when the event is not found', async () => {
      // Use no-error null response so service returns null (not throws)
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({ method: 'GET', url: '/event/ghost-id' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Event not found' });
    });

    it('returns 500 when the service throws', async () => {
      const brokenBuilder = createSupabaseMock({ data: null, error: null });
      (brokenBuilder.single as any).mockRejectedValueOnce(new Error('db crash'));
      supabaseMock.from.mockReturnValue(brokenBuilder);

      const res = await app.inject({ method: 'GET', url: '/event/crash-id' });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /event ───────────────────────────────────────────────────────────────

  describe('POST /event', () => {
    const validPayload = {
      name: 'Cape Town Food Fest',
      startDate: '2026-06-01T10:00:00.000Z',
      endDate: '2026-06-01T22:00:00.000Z',
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
      code: 'CTFOODFEST',
    };

    it('returns 201 with the created event', async () => {
      const dbEvent = makeEvent({
        id: 'new-event-uuid',
        name: 'Cape Town Food Fest',
        code: 'CTFOODFEST',
        status: 'ACTIVE',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbEvent, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('event');
      expect(body.event.name).toBe('Cape Town Food Fest');
      expect(body.event.code).toBe('CTFOODFEST');
      expect(body.event.status).toBe('ACTIVE');
    });

    it('returns 500 when the database insert fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'insert failed' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(500);
    });

    it('returns 400 when a required field is missing', async () => {
      const { name: _name, ...missingName } = validPayload;

      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: missingName,
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── PATCH /event/:id ─────────────────────────────────────────────────────────

  describe('PATCH /event/:id', () => {
    it('returns 200 with the updated event', async () => {
      const updatedDbEvent = makeEvent({
        id: 'ev-patch-id',
        name: 'Renamed Event',
        status: 'ACTIVE',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: updatedDbEvent, error: null }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/event/ev-patch-id',
        payload: { name: 'Renamed Event', status: 'ACTIVE' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.event.name).toBe('Renamed Event');
      expect(body.event.status).toBe('ACTIVE');
    });

    it('returns 500 when the event to update does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'not found' } }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/event/ghost-event',
        payload: { name: 'Ghost' },
      });

      expect(res.statusCode).toBe(500);
    });

    it('returns 400 when an invalid status value is supplied', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/event/any-id',
        payload: { status: 'INVALID_STATUS' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── DELETE /event/:id ─────────────────────────────────────────────────────────

  describe('DELETE /event/:id', () => {
    it('returns 204 on successful deletion', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({ method: 'DELETE', url: '/event/ev-to-delete' });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
    });

    it('returns 500 when deletion fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'delete failed' } }),
      );

      const res = await app.inject({ method: 'DELETE', url: '/event/locked-ev' });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /event/:id/vendors ───────────────────────────────────────────────────

  describe('POST /event/:id/vendors', () => {
    it('returns 401 without authentication', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event/ev-abc/vendors',
        payload: { invites: [{ vendorId: 'v-1', commissionRate: 10 }] },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when invites is missing from the request body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event/ev-abc/vendors',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when commission rate exceeds 50', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event/ev-abc/vendors',
        payload: { invites: [{ vendorId: 'v-1', commissionRate: 60 }] },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── DELETE /event/:id/vendors/:vendorId ───────────────────────────────────────

  describe('DELETE /event/:id/vendors/:vendorId', () => {
    it('returns 204 after removing a vendor from the event', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/event/ev-abc/vendors/vendor-xyz',
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 500 when the removal fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'delete failed' } }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/event/ev-abc/vendors/vendor-xyz',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /event/vendor/:vendorId ───────────────────────────────────────────────

  describe('GET /event/vendor/:vendorId', () => {
    it('returns 200 with all events for the given vendor', async () => {
      const dbEvent1 = makeEvent({ id: 'ev-1', name: 'Event One' });
      const dbEvent2 = makeEvent({ id: 'ev-2', name: 'Event Two' });

      mockFromSequence([
        createSupabaseMock({ data: [{ events: dbEvent1 }, { events: dbEvent2 }], error: null }),
        // Menu config lookup for both events
        createSupabaseMock({ data: [], error: null }),
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/event/vendor/vendor-abc',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('events');
      expect(body.events).toHaveLength(2);
      expect(body.events[0].name).toBe('Event One');
      expect(body.events[1].name).toBe('Event Two');
    });

    it('returns 200 with an empty array when the vendor has no events', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/event/vendor/vendor-no-events',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ events: [] });
    });

    it('returns 200 with only active events when ?active=true is set', async () => {
      const futureEvent = makeEvent({
        id: 'ev-future',
        end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      const mockBuilder = createSupabaseMock({
        data: [{ events: futureEvent }],
        error: null,
      });

      mockFromSequence([
        mockBuilder,
        createSupabaseMock({ data: [], error: null }),
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/event/vendor/vendor-abc?active=true',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toHaveLength(1);
      // Verify the gte filter was applied for active=true
      expect(mockBuilder.gte).toHaveBeenCalledWith('events.end_date', expect.any(String));
    });

    it('does not apply the active filter when ?active=false is set', async () => {
      const mockBuilder = createSupabaseMock({ data: [], error: null });
      supabaseMock.from.mockReturnValue(mockBuilder);

      const res = await app.inject({
        method: 'GET',
        url: '/event/vendor/vendor-abc?active=false',
      });

      expect(res.statusCode).toBe(200);
      expect(mockBuilder.gte).not.toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'query failed' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/event/vendor/vendor-broken',
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
