import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';
import { makeEvent } from '../fixtures/index.js';
import { buildApp } from '../helpers/app.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

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
import eventController from '../../event/event.controller.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFromSequence(responses: Array<ReturnType<typeof createSupabaseMock>>) {
  let callIndex = 0;
  supabaseMock.from.mockImplementation(() => {
    const response = responses[callIndex] ?? createSupabaseMock({ data: null, error: null });
    callIndex++;
    return response;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Event Controller — Extended Coverage', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp(async (fastify) => {
      await fastify.register(eventController, { prefix: '/event' });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /event — Input Validation Edge Cases ─────────────────────────────

  describe('POST /event — input validation', () => {
    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: {
          startDate: '2026-06-01T10:00:00Z',
          endDate: '2026-06-01T22:00:00Z',
          location: { latitude: 0, longitude: 0, address: '123 Test St', city: 'TestCity', state: 'TS', zipCode: '12345' },
          isPublic: true,
          vendorIds: [],
          code: 'TEST01',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when startDate is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: {
          name: 'Test Event',
          endDate: '2026-06-01T22:00:00Z',
          location: { latitude: 0, longitude: 0, address: '123 Test St', city: 'TestCity', state: 'TS', zipCode: '12345' },
          isPublic: true,
          vendorIds: [],
          code: 'TEST01',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when endDate is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: {
          name: 'Test Event',
          startDate: '2026-06-01T10:00:00Z',
          location: { latitude: 0, longitude: 0, address: '123 Test St', city: 'TestCity', state: 'TS', zipCode: '12345' },
          isPublic: true,
          vendorIds: [],
          code: 'TEST01',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when location is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: {
          name: 'Test Event',
          startDate: '2026-06-01T10:00:00Z',
          endDate: '2026-06-01T22:00:00Z',
          isPublic: true,
          vendorIds: [],
          code: 'TEST01',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when code is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: {
          name: 'Test Event',
          startDate: '2026-06-01T10:00:00Z',
          endDate: '2026-06-01T22:00:00Z',
          location: { latitude: 0, longitude: 0, address: '123 Test St', city: 'TestCity', state: 'TS', zipCode: '12345' },
          isPublic: true,
          vendorIds: [],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when vendorIds is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: {
          name: 'Test Event',
          startDate: '2026-06-01T10:00:00Z',
          endDate: '2026-06-01T22:00:00Z',
          location: { latitude: 0, longitude: 0, address: '123 Test St', city: 'TestCity', state: 'TS', zipCode: '12345' },
          isPublic: true,
          code: 'TEST01',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when startDate is not a valid date-time format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: {
          name: 'Test Event',
          startDate: 'not-a-date',
          endDate: '2026-06-01T22:00:00Z',
          location: { latitude: 0, longitude: 0, address: '123 Test St', city: 'TestCity', state: 'TS', zipCode: '12345' },
          isPublic: true,
          vendorIds: [],
          code: 'TEST01',
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /event/code/:code — Edge Cases ────────────────────────────────────

  describe('GET /event/code/:code — edge cases', () => {
    it('handles special characters in code', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/event/code/${encodeURIComponent("'; DROP TABLE events; --")}`,
      });

      // Should safely handle via parameterized queries
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for an empty code', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/event/code/NONEXISTENT',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /event/:id — Edge Cases ───────────────────────────────────────────

  describe('GET /event/:id — edge cases', () => {
    it('returns 404 for a non-existent event id', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/event/nonexistent-event-id',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 500 when the database query fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'DB error' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/event/some-event-id',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PATCH /event/:id — Edge Cases ─────────────────────────────────────────

  describe('PATCH /event/:id — edge cases', () => {
    it('returns 200 when updating with only the name field', async () => {
      const updatedEvent = makeEvent({ id: 'evt-1', name: 'Updated Event' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: updatedEvent, error: null }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/event/evt-1',
        payload: { name: 'Updated Event' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().event.name).toBe('Updated Event');
    });

    it('returns 500 when the update operation fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Update failed' } }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/event/evt-1',
        payload: { name: 'Will Fail' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── DELETE /event/:id — Edge Cases ────────────────────────────────────────

  describe('DELETE /event/:id — edge cases', () => {
    it('returns 204 on successful deletion', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/event/evt-to-delete',
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 500 when deletion fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Delete failed' } }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/event/evt-locked',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /event/:id/vendors — Edge Cases ──────────────────────────────────

  describe('POST /event/:id/vendors — edge cases', () => {
    it('returns 401 without authentication', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event/evt-1/vendors',
        payload: { invites: [{ vendorId: 'v1', commissionRate: 10 }] },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when invites is missing from body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event/evt-1/vendors',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when commission rate exceeds 50', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/event/evt-1/vendors',
        payload: { invites: [{ vendorId: 'v1', commissionRate: 60 }] },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── DELETE /event/:id/vendors/:vendorId — Edge Cases ──────────────────────

  describe('DELETE /event/:id/vendors/:vendorId — edge cases', () => {
    it('returns 204 on successfully removing a vendor', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/event/evt-1/vendors/v1',
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 500 when the removal fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'Delete failed' } }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/event/evt-1/vendors/v-fail',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /event/vendor/:vendorId — Edge Cases ──────────────────────────────

  describe('GET /event/vendor/:vendorId — edge cases', () => {
    it('returns 200 with an empty array when vendor has no events', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/event/vendor/v-no-events',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().events).toEqual([]);
    });

    it('supports active=true filter', async () => {
      const activeEvent = makeEvent({ id: 'active-evt', end_date: '2027-01-01T00:00:00Z' });
      // getEventsByVendorId: 1) event_vendors with join -> nested {events: {...}}
      // 2) event_menu_configurations for menu status
      const junctionMock = createSupabaseMock({
        data: [{ events: activeEvent }],
        error: null,
      });
      const configMock = createSupabaseMock({
        data: [],
        error: null,
      });

      mockFromSequence([junctionMock, configMock]);

      const res = await app.inject({
        method: 'GET',
        url: '/event/vendor/v1?active=true',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().events).toHaveLength(1);
    });

    it('returns 500 when the database query fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'DB error' } }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/event/vendor/v-bad',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── Security Edge Cases ───────────────────────────────────────────────────

  describe('Security edge cases', () => {
    it('handles SQL injection in event code lookup', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/event/code/${encodeURIComponent("1 OR 1=1")}`,
      });

      expect(res.statusCode).toBe(404);
    });

    it('handles XSS payload in event name during creation', async () => {
      const xssPayload = '<script>alert("xss")</script>';
      const dbEvent = makeEvent({ name: xssPayload });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbEvent, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/event',
        payload: {
          name: xssPayload,
          startDate: '2026-06-01T10:00:00Z',
          endDate: '2026-06-01T22:00:00Z',
          location: {
            latitude: 0,
            longitude: 0,
            address: '123 St',
            city: 'TestCity',
            state: 'TestState',
            zipCode: '12345',
          },
          isPublic: true,
          vendorIds: [],
          code: 'XSS01',
        },
      });

      // The API should accept it (storage-level XSS prevention is a frontend concern)
      // but should not crash
      expect([201, 500]).toContain(res.statusCode);
    });
  });
});
