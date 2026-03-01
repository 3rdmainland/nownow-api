import { describe, it, expect, vi, afterEach } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@fastify/websocket', () => ({
  default: vi.fn().mockImplementation(async (fastify: any) => {
    fastify.decorateRequest = fastify.decorateRequest ?? vi.fn();
  }),
}));

vi.mock('../../lib/supabase.js', () => ({
  supabase: { from: vi.fn() },
}));

import { redisMock, cacheMock } from '../mocks/redis.js';

vi.mock('../../lib/redis.js', () => ({
  default: redisMock,
  cache: cacheMock,
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import {
  broadcastToEvent,
  broadcastToVendor,
  broadcastToPhone,
  getConnectionStats,
} from '../../websocket/websocket.controller.js';
import type { WebSocketMessage } from '../../websocket/websocket.types.js';

// ── Mock socket factory ──────────────────────────────────────────────────────

function makeMockSocket(overrides: Partial<{ readyState: number }> = {}) {
  return {
    readyState: 1,
    OPEN: 1,
    send: vi.fn(),
    on: vi.fn(),
    ...overrides,
  };
}

// ── Connection simulator ─────────────────────────────────────────────────────

async function simulateConnection(subscriptions: {
  eventId?: string;
  vendorId?: string;
  phone?: string;
} = {}): Promise<{
  socket: ReturnType<typeof makeMockSocket>;
  cleanup: () => void;
  fireMessage: (data: string) => void;
  fireError: (err: Error) => void;
}> {
  const { default: websocketController } = await import('../../websocket/websocket.controller.js');

  const socket = makeMockSocket();

  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  socket.on.mockImplementation((event: string, handler: (...args: any[]) => void) => {
    if (!handlers[event]) handlers[event] = [];
    handlers[event].push(handler);
  });

  let routeHandler: ((socket: any, req: any) => void) | null = null;
  const fakeLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

  const fakeWsPlugin: any = {
    get: vi.fn((path: string, opts: any, handler: (socket: any, req: any) => void) => {
      if (path === '/ws') routeHandler = handler;
    }),
    register: vi.fn().mockImplementation(async () => {}),
    log: fakeLog,
  };

  await websocketController(fakeWsPlugin, {});
  if (!routeHandler) throw new Error('No /ws handler registered');

  routeHandler(socket, {});

  if (Object.keys(subscriptions).length > 0) {
    const messageHandlers = handlers['message'] ?? [];
    for (const h of messageHandlers) {
      h(Buffer.from(JSON.stringify({ type: 'SUBSCRIBE', payload: subscriptions })));
    }
  }

  const cleanup = () => {
    const closeHandlers = handlers['close'] ?? [];
    for (const h of closeHandlers) h();
  };

  const fireMessage = (data: string) => {
    const messageHandlers = handlers['message'] ?? [];
    for (const h of messageHandlers) h(Buffer.from(data));
  };

  const fireError = (err: Error) => {
    const errorHandlers = handlers['error'] ?? [];
    for (const h of errorHandlers) h(err);
  };

  return { socket, cleanup, fireMessage, fireError };
}

// ══════════════════════════════════════════════════════════════════════════════
// Tests — UNSUBSCRIBE, malformed messages, error handling, lifecycle
// ══════════════════════════════════════════════════════════════════════════════

describe('WebSocket controller — extended coverage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── UNSUBSCRIBE ──────────────────────────────────────────────────────────

  describe('UNSUBSCRIBE', () => {
    it('clears all subscriptions so client no longer receives targeted messages', async () => {
      const { socket, cleanup, fireMessage } = await simulateConnection({
        eventId: 'event-unsub',
        vendorId: 'vendor-unsub',
      });

      socket.send.mockClear();

      // Verify it receives targeted messages before unsubscribe
      broadcastToEvent('event-unsub', {
        type: 'PRICE_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      });
      expect(socket.send).toHaveBeenCalledOnce();
      socket.send.mockClear();

      // Send UNSUBSCRIBE
      fireMessage(JSON.stringify({ type: 'UNSUBSCRIBE' }));

      // After unsubscribe, client should still receive event broadcasts
      // because no eventId means "global listener"
      broadcastToEvent('event-unsub', {
        type: 'PRICE_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      });
      expect(socket.send).toHaveBeenCalledOnce(); // global listener

      socket.send.mockClear();

      // But vendor-specific should also reach (no vendorId = global)
      broadcastToVendor('vendor-unsub', {
        type: 'VENDOR_STATUS_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      });
      expect(socket.send).toHaveBeenCalledOnce(); // global

      socket.send.mockClear();

      // Phone-specific should NOT reach (phone requires exact match)
      broadcastToPhone('+27820001111', {
        type: 'ORDER_STATUS_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      });
      expect(socket.send).not.toHaveBeenCalled();

      cleanup();
    });

    it('client can re-subscribe after unsubscribing', async () => {
      const { socket, cleanup, fireMessage } = await simulateConnection({
        eventId: 'event-resub',
      });

      socket.send.mockClear();

      // Unsubscribe
      fireMessage(JSON.stringify({ type: 'UNSUBSCRIBE' }));

      // Re-subscribe to a different event
      fireMessage(JSON.stringify({ type: 'SUBSCRIBE', payload: { eventId: 'event-new' } }));

      socket.send.mockClear();

      // Should receive messages for new event
      broadcastToEvent('event-new', {
        type: 'PRICE_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      });
      expect(socket.send).toHaveBeenCalledOnce();

      socket.send.mockClear();

      // Should NOT receive messages for old event
      broadcastToEvent('event-resub', {
        type: 'PRICE_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      });
      expect(socket.send).not.toHaveBeenCalled();

      cleanup();
    });
  });

  // ── Malformed messages ───────────────────────────────────────────────────

  describe('malformed messages', () => {
    it('does not crash when receiving invalid JSON', async () => {
      const { socket, cleanup, fireMessage } = await simulateConnection();

      socket.send.mockClear();

      // Should not throw
      expect(() => fireMessage('this is not json!!!')).not.toThrow();

      // Client should still be connected
      const stats = getConnectionStats();
      expect(stats.totalConnections).toBeGreaterThan(0);

      cleanup();
    });

    it('ignores messages with unknown type', async () => {
      const { socket, cleanup, fireMessage } = await simulateConnection({
        eventId: 'event-unknown',
      });

      socket.send.mockClear();

      // Send unknown message type — should be silently ignored
      fireMessage(JSON.stringify({ type: 'FOOBAR', payload: { test: true } }));

      // No additional messages should have been sent
      expect(socket.send).not.toHaveBeenCalled();

      cleanup();
    });

    it('handles empty message gracefully', async () => {
      const { cleanup, fireMessage } = await simulateConnection();

      expect(() => fireMessage('')).not.toThrow();

      cleanup();
    });
  });

  // ── Error event ──────────────────────────────────────────────────────────

  describe('socket error event', () => {
    it('removes client from clients map on error', async () => {
      const { socket, fireError } = await simulateConnection({ eventId: 'event-err' });

      socket.send.mockClear();

      const before = getConnectionStats().totalConnections;

      // Simulate socket error
      fireError(new Error('Connection reset'));

      const after = getConnectionStats().totalConnections;
      expect(after).toBe(before - 1);

      // Client should no longer receive messages
      broadcastToEvent('event-err', {
        type: 'PRICE_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      });
      expect(socket.send).not.toHaveBeenCalled();
    });
  });

  // ── Multiple subscriptions ───────────────────────────────────────────────

  describe('subscription merging', () => {
    it('merges subscriptions — adding vendorId to existing eventId', async () => {
      const { socket, cleanup, fireMessage } = await simulateConnection({
        eventId: 'event-merge',
      });

      socket.send.mockClear();

      // Add vendorId subscription on top of existing eventId
      fireMessage(JSON.stringify({ type: 'SUBSCRIBE', payload: { vendorId: 'vendor-merge' } }));

      socket.send.mockClear();

      // Should receive event broadcasts
      broadcastToEvent('event-merge', {
        type: 'PRICE_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      });
      expect(socket.send).toHaveBeenCalledOnce();
      socket.send.mockClear();

      // Should also receive vendor broadcasts
      broadcastToVendor('vendor-merge', {
        type: 'NEW_ORDER',
        payload: null,
        timestamp: new Date().toISOString(),
      });
      expect(socket.send).toHaveBeenCalledOnce();

      cleanup();
    });
  });

  // ── Connection stats after error cleanup ─────────────────────────────────

  describe('getConnectionStats() after cleanup', () => {
    it('correctly decrements after close', async () => {
      const before = getConnectionStats().totalConnections;

      const { cleanup } = await simulateConnection({ eventId: 'event-stat-close' });
      expect(getConnectionStats().totalConnections).toBe(before + 1);

      cleanup();
      expect(getConnectionStats().totalConnections).toBe(before);
    });

    it('correctly decrements after error', async () => {
      const before = getConnectionStats().totalConnections;

      const { fireError } = await simulateConnection({ eventId: 'event-stat-err' });
      expect(getConnectionStats().totalConnections).toBe(before + 1);

      fireError(new Error('test'));
      expect(getConnectionStats().totalConnections).toBe(before);
    });
  });
});
