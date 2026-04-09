import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { makeOrder, makeEvent } from '../fixtures/index.js';
import { OrderStatus } from '../../orders/order.types.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));

vi.mock('../../lib/redis.js', () => ({
  default: redisMock,
  redis: redisMock,
  cache: cacheMock,
  CACHE_TTL: CACHE_TTL_MOCK,
}));

// Import after mocks
import { OrderScheduler } from '../../orders/order.scheduler.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFromSequence(responses: Array<{ data: any; error: any }>) {
  let callIndex = 0;
  supabaseMock.from.mockImplementation(() => {
    const response = responses[callIndex] ?? { data: null, error: null };
    callIndex++;
    return createSupabaseMock(response);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OrderScheduler', () => {
  let scheduler: OrderScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = new OrderScheduler();
  });

  // ── calculateActualPrepTime ────────────────────────────────────────────────

  describe('calculateActualPrepTime', () => {
    it('should return the difference in minutes between preparedAt and readyAt', () => {
      const preparedAt = '2026-01-01T10:00:00.000Z';
      const readyAt = '2026-01-01T10:15:00.000Z';

      const result = scheduler.calculateActualPrepTime(preparedAt, readyAt);

      expect(result).toBe(15);
    });

    it('should return 0 when preparedAt and readyAt are the same', () => {
      const time = '2026-01-01T10:00:00.000Z';

      const result = scheduler.calculateActualPrepTime(time, time);

      expect(result).toBe(0);
    });

    it('should handle fractional minutes by rounding', () => {
      const preparedAt = '2026-01-01T10:00:00.000Z';
      // 7.5 minutes later
      const readyAt = '2026-01-01T10:07:30.000Z';

      const result = scheduler.calculateActualPrepTime(preparedAt, readyAt);

      expect(result).toBe(8); // Math.round(7.5) = 8
    });

    it('should return 1 minute for exactly 60 seconds', () => {
      const preparedAt = '2026-01-01T10:00:00.000Z';
      const readyAt = '2026-01-01T10:01:00.000Z';

      const result = scheduler.calculateActualPrepTime(preparedAt, readyAt);

      expect(result).toBe(1);
    });

    it('should handle large time differences', () => {
      const preparedAt = '2026-01-01T10:00:00.000Z';
      const readyAt = '2026-01-01T12:30:00.000Z'; // 2.5 hours later

      const result = scheduler.calculateActualPrepTime(preparedAt, readyAt);

      expect(result).toBe(150);
    });
  });

  // ── validateImmediateOrder ─────────────────────────────────────────────────

  describe('validateImmediateOrder', () => {
    it('should return isValid false when event is not found', async () => {
      mockFromSequence([
        { data: null, error: { message: 'Not found' } }, // event query
      ]);

      const result = await scheduler.validateImmediateOrder('vendor-1', 'event-1', 12);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Event not found');
    });

    it('should return isValid false when order cannot be ready before event ends', async () => {
      // Event that ends in 5 minutes
      const event = makeEvent({
        end_date: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        status: 'ACTIVE',
      });

      mockFromSequence([
        { data: event, error: null }, // event query
      ]);

      // estimatedPrepTime = 30 minutes, event ends in 5 minutes
      const result = await scheduler.validateImmediateOrder('vendor-1', event.id, 30);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Order cannot be completed before event ends');
    });

    it('should return isValid true when order can be fulfilled', async () => {
      // Event that ends in 2 hours
      const event = makeEvent({
        end_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        status: 'ACTIVE',
      });

      mockFromSequence([
        { data: event, error: null },   // event query
        { data: [], error: null },       // calculateQueuePosition - pending orders
      ]);

      const result = await scheduler.validateImmediateOrder('vendor-1', event.id, 12);

      expect(result.isValid).toBe(true);
      expect(result.estimatedReadyTime).toBeDefined();
      expect(result.queuePosition).toBeDefined();
    });
  });

  // ── validateScheduledOrder ────────────────────────────────────────────────

  describe('validateScheduledOrder', () => {
    it('should return isValid false when event is not found', async () => {
      mockFromSequence([
        { data: null, error: { message: 'Not found' } },
      ]);

      const result = await scheduler.validateScheduledOrder(
        'vendor-1',
        'event-1',
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        12,
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Event not found');
    });

    it('should return isValid false when event is not active', async () => {
      const event = makeEvent({ status: 'CANCELED' });

      mockFromSequence([
        { data: event, error: null },
      ]);

      const result = await scheduler.validateScheduledOrder(
        'vendor-1',
        event.id,
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        12,
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Event is not active');
    });

    it('should return isValid false when pickup time is outside event period', async () => {
      const event = makeEvent({
        start_date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        end_date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        status: 'ACTIVE',
      });

      mockFromSequence([
        { data: event, error: null },
      ]);

      // Pickup time 3 hours from now, but event ends in 1 hour
      const result = await scheduler.validateScheduledOrder(
        'vendor-1',
        event.id,
        new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        12,
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Pickup time must be between');
    });

    it('should return isValid false when pickup time is too soon (less than prep time)', async () => {
      const event = makeEvent({
        start_date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        end_date: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
        status: 'ACTIVE',
      });

      mockFromSequence([
        { data: event, error: null },
      ]);

      // Pickup time 5 minutes from now, but prep time is 30 minutes
      const result = await scheduler.validateScheduledOrder(
        'vendor-1',
        event.id,
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        30,
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Pickup time must be at least 30 minutes from now');
    });

    it('should return isValid true when all conditions are met', async () => {
      const event = makeEvent({
        start_date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        end_date: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
        status: 'ACTIVE',
      });

      mockFromSequence([
        { data: event, error: null },   // event query
        { data: [], error: null },       // calculateQueuePosition - pending orders
      ]);

      // Pickup time 2 hours from now, prep time 12 minutes - should be valid
      const result = await scheduler.validateScheduledOrder(
        'vendor-1',
        event.id,
        new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        12,
      );

      expect(result.isValid).toBe(true);
      expect(result.estimatedReadyTime).toBeDefined();
      expect(result.queuePosition).toBeDefined();
    });
  });

  // ── updateQueuePositions ──────────────────────────────────────────────────

  describe('updateQueuePositions', () => {
    it('should call batch RPC to update queue positions', async () => {
      supabaseMock.rpc.mockResolvedValue({ data: null, error: null });

      await scheduler.updateQueuePositions('vendor-1');

      expect(supabaseMock.rpc).toHaveBeenCalledWith('batch_update_queue_positions', {
        p_vendor_id: 'vendor-1',
      });
    });

    it('should not throw when RPC returns an error (logs and returns)', async () => {
      supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

      // updateQueuePositions catches the error and logs it - should not throw
      await expect(scheduler.updateQueuePositions('vendor-1')).resolves.toBeUndefined();
    });

    it('should handle successful RPC call gracefully', async () => {
      supabaseMock.rpc.mockResolvedValue({ data: null, error: null });

      await scheduler.updateQueuePositions('vendor-1');

      // Should use a single RPC call instead of N individual updates
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    });
  });
});
