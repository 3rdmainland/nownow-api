import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Module mocks (must be declared before any imports that load these modules) ─

vi.mock('@fastify/websocket', () => ({
  default: vi.fn().mockImplementation(async (fastify: any) => {
    // Minimal stub: just mark the plugin as registered so the controller can
    // call fastify.get('/ws', { websocket: true }, handler) without crashing.
    fastify.decorateRequest = fastify.decorateRequest ?? vi.fn();
  }),
}));

vi.mock('../../lib/supabase.js', () => ({
  supabase: { from: vi.fn() },
  safeQuery: (fn: any) => fn(),
  CircuitOpenError: class CircuitOpenError extends Error {},
}));

import { redisMock, cacheMock } from '../mocks/redis.js';

vi.mock('../../lib/redis.js', () => ({
  default: redisMock,
  cache: cacheMock,
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import {
  broadcast,
  broadcastToEvent,
  broadcastToVendor,
  broadcastToPhone,
  broadcastOrderStatusUpdate,
  broadcastNewOrder,
  broadcastPriceUpdate,
  broadcastAvailabilityUpdate,
  broadcastVendorStatus,
  broadcastMenuItemUpdate,
  getConnectionStats,
} from '../../websocket/websocket.controller.js';
import type {
  OrderStatusUpdatePayload,
  NewOrderPayload,
  PriceUpdatePayload,
  ItemAvailabilityPayload,
  VendorStatusPayload,
  WebSocketMessage,
  MenuItemUpdatePayload,
} from '../../websocket/websocket.types.js';
import { buildApp } from '../helpers/app.js';

// ── WebSocket socket factory ──────────────────────────────────────────────────

/**
 * Returns a minimal mock that behaves like a ws.WebSocket instance.
 * The `readyState` is OPEN by default (matching WebSocket.OPEN = 1).
 */
function makeMockSocket(overrides: Partial<{ readyState: number }> = {}) {
  const socket = {
    readyState: 1, // WebSocket.OPEN
    OPEN: 1,
    send: vi.fn(),
    on: vi.fn(),
    ...overrides,
  };
  return socket;
}

// ── Shared client-injection helper ───────────────────────────────────────────
// Because `clients` is not exported, the cleanest way to add a controlled
// socket is to use a helper that calls the module's own handler logic.
// We achieve this by importing the *default* export (websocketController) and
// building a tiny fake Fastify instance, then simulating a connection.

/**
 * Build a fresh fake Fastify instance that captures the websocket route handler
 * registered by `websocketController`, then simulate a client connecting and
 * optionally sending a SUBSCRIBE message.
 *
 * Returns `{ socket, cleanup }` where `cleanup` simulates the client disconnecting.
 */
async function simulateConnection(subscriptions: {
  eventId?: string;
  vendorId?: string;
  phone?: string;
  admin?: boolean;
} = {}, auth?: {
  userId?: string;
  role?: 'vendor' | 'organizer' | 'admin' | 'customer';
  vendorId?: string;
}): Promise<{ socket: ReturnType<typeof makeMockSocket>; cleanup: () => void }> {
  const mod = await import('../../websocket/websocket.controller.js');
  const websocketController = mod.default as (...args: any[]) => Promise<void>;

  const socket = makeMockSocket();

  // Capture the message and close handlers registered by the controller
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  socket.on.mockImplementation((event: string, handler: (...args: any[]) => void) => {
    if (!handlers[event]) handlers[event] = [];
    handlers[event].push(handler);
  });

  // Build a fake Fastify with enough surface for the controller's /ws route
  let routeHandler: ((socket: any, req: any) => void) | null = null;

  const fakeLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

  const fakeWsPlugin: any = {
    get: vi.fn((path: string, opts: any, handler?: (socket: any, req: any) => void) => {
      // The /ws route is registered with { websocket: true } as opts
      if (path === '/ws' && handler) routeHandler = handler;
    }),
    register: vi.fn().mockImplementation(async (_plugin: any, _opts?: any) => {
      // Simulate @fastify/websocket doing nothing in the test
    }),
    addHook: vi.fn(),
    log: fakeLog,
    jwt: {
      verify: vi.fn((token: string) => {
        // Return the auth payload if token matches our test token
        if (token === 'test-jwt-token' && auth) {
          return {
            userId: auth.userId || 'test-user-id',
            role: auth.role || 'vendor',
            vendorId: auth.vendorId,
          };
        }
        throw new Error('Invalid token');
      }),
    },
  };

  // Execute the controller to register handlers
  await websocketController(fakeWsPlugin, {});

  if (!routeHandler) {
    throw new Error('websocketController did not register a /ws route handler');
  }

  // Build a fake request with optional auth token
  const fakeReq: any = {
    url: auth ? '/ws?token=test-jwt-token' : '/ws',
    headers: { host: 'localhost:3002' },
  };

  // Simulate the client connecting (this adds the socket to `clients`)
  (routeHandler as (socket: any, req: any) => void)(socket, fakeReq);

  // Simulate sending a SUBSCRIBE message if subscriptions are provided
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

  return { socket, cleanup };
}

// ══════════════════════════════════════════════════════════════════════════════
// Test suites
// ══════════════════════════════════════════════════════════════════════════════

describe('WebSocket controller – broadcast functions', () => {
  // Each test builds its own isolated set of sockets via simulateConnection().
  // Because the `clients` Map is module-level state, we must clean up after
  // every test to avoid cross-contamination.

  afterEach(() => {
    // Reset all mock call histories
    vi.clearAllMocks();
  });

  // ── broadcast() ────────────────────────────────────────────────────────────

  describe('broadcast()', () => {
    it('sends a JSON-stringified message to every connected client', async () => {
      const { socket: s1, cleanup: c1 } = await simulateConnection();
      const { socket: s2, cleanup: c2 } = await simulateConnection();

      // Clear the call histories accumulated during connection setup
      // (each connection receives a CONNECTED welcome message on connect).
      s1.send.mockClear();
      s2.send.mockClear();

      const message: WebSocketMessage<{ info: string }> = {
        type: 'PRICE_UPDATE',
        payload: { info: 'hello' },
        timestamp: new Date().toISOString(),
      };

      broadcast(message);

      expect(s1.send).toHaveBeenCalledOnce();
      expect(s1.send).toHaveBeenCalledWith(JSON.stringify(message));
      expect(s2.send).toHaveBeenCalledOnce();
      expect(s2.send).toHaveBeenCalledWith(JSON.stringify(message));

      c1(); c2();
    });

    it('skips clients whose socket is not OPEN', async () => {
      const { socket: open, cleanup: c1 } = await simulateConnection();
      const { socket: closed, cleanup: c2 } = await simulateConnection();

      // Clear welcome-message call history, then mark one socket as closed.
      open.send.mockClear();
      closed.send.mockClear();
      closed.readyState = 3; // WebSocket.CLOSED

      const message: WebSocketMessage<null> = {
        type: 'PRICE_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      };

      broadcast(message);

      expect(open.send).toHaveBeenCalledOnce();
      expect(closed.send).not.toHaveBeenCalled();

      c1(); c2();
    });

    it('sends nothing when there are no connected clients', () => {
      // After all cleanups in other tests the map might not be empty yet in
      // isolation mode, but this test is intentionally self-contained.
      const message: WebSocketMessage<null> = {
        type: 'NEW_ORDER',
        payload: null,
        timestamp: new Date().toISOString(),
      };
      // Should not throw
      expect(() => broadcast(message)).not.toThrow();
    });
  });

  // ── broadcastToEvent() ─────────────────────────────────────────────────────

  describe('broadcastToEvent()', () => {
    it('sends to clients subscribed to the exact eventId', async () => {
      const { socket: subbed, cleanup: c1 } = await simulateConnection({ eventId: 'event-123' });
      const { socket: other, cleanup: c2 } = await simulateConnection({ eventId: 'event-999' });

      // Clear setup messages (CONNECTED + SUBSCRIBED ack) before the broadcast.
      subbed.send.mockClear();
      other.send.mockClear();

      const message: WebSocketMessage<null> = {
        type: 'PRICE_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      };

      broadcastToEvent('event-123', message);

      expect(subbed.send).toHaveBeenCalledOnce();
      expect(other.send).not.toHaveBeenCalled();

      c1(); c2();
    });

    it('does NOT send to clients with no eventId subscription (targeted only)', async () => {
      const { socket: global, cleanup: c1 } = await simulateConnection({}); // no eventId
      const { socket: specific, cleanup: c2 } = await simulateConnection({ eventId: 'event-123' });

      global.send.mockClear();
      specific.send.mockClear();

      const message: WebSocketMessage<null> = {
        type: 'PRICE_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      };

      broadcastToEvent('event-123', message);

      // Unsubscribed clients should NOT receive targeted broadcasts
      expect(global.send).not.toHaveBeenCalled();
      // Specific subscriber should receive it
      expect(specific.send).toHaveBeenCalledOnce();

      c1(); c2();
    });

    it('does not send to clients subscribed to a different event', async () => {
      const { socket, cleanup } = await simulateConnection({ eventId: 'event-aaa' });

      socket.send.mockClear();

      const message: WebSocketMessage<null> = {
        type: 'PRICE_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      };

      broadcastToEvent('event-bbb', message);

      expect(socket.send).not.toHaveBeenCalled();

      cleanup();
    });
  });

  // ── broadcastToVendor() ────────────────────────────────────────────────────

  describe('broadcastToVendor()', () => {
    it('sends only to clients subscribed to the given vendorId', async () => {
      const { socket: vendor1, cleanup: c1 } = await simulateConnection({ vendorId: 'vendor-abc' }, { userId: 'u1', role: 'vendor', vendorId: 'vendor-abc' });
      const { socket: vendor2, cleanup: c2 } = await simulateConnection({ vendorId: 'vendor-xyz' }, { userId: 'u2', role: 'vendor', vendorId: 'vendor-xyz' });

      vendor1.send.mockClear();
      vendor2.send.mockClear();

      const message: WebSocketMessage<null> = {
        type: 'VENDOR_STATUS_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      };

      broadcastToVendor('vendor-abc', message);

      expect(vendor1.send).toHaveBeenCalledOnce();
      expect(vendor2.send).not.toHaveBeenCalled();

      c1(); c2();
    });

    it('does NOT send to clients with no vendorId (targeted only)', async () => {
      const { socket: global, cleanup: c1 } = await simulateConnection({});
      const { socket: targeted, cleanup: c2 } = await simulateConnection({ vendorId: 'vendor-abc' }, { userId: 'u1', role: 'vendor', vendorId: 'vendor-abc' });

      global.send.mockClear();
      targeted.send.mockClear();

      const message: WebSocketMessage<null> = {
        type: 'VENDOR_STATUS_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      };

      broadcastToVendor('vendor-abc', message);

      // Unsubscribed clients should NOT receive targeted broadcasts
      expect(global.send).not.toHaveBeenCalled();
      expect(targeted.send).toHaveBeenCalledOnce();

      c1(); c2();
    });
  });

  // ── broadcastToPhone() ─────────────────────────────────────────────────────

  describe('broadcastToPhone()', () => {
    it('sends only to the client subscribed to the given phone number', async () => {
      const { socket: rightPhone, cleanup: c1 } = await simulateConnection({ phone: '+27821234567' });
      const { socket: wrongPhone, cleanup: c2 } = await simulateConnection({ phone: '+27827654321' });
      const { socket: noPhone, cleanup: c3 } = await simulateConnection({});

      rightPhone.send.mockClear();
      wrongPhone.send.mockClear();
      noPhone.send.mockClear();

      const message: WebSocketMessage<null> = {
        type: 'ORDER_STATUS_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      };

      broadcastToPhone('+27821234567', message);

      expect(rightPhone.send).toHaveBeenCalledOnce();
      expect(wrongPhone.send).not.toHaveBeenCalled();
      // Unlike event/vendor, phone subscriptions are exact-match only
      expect(noPhone.send).not.toHaveBeenCalled();

      c1(); c2(); c3();
    });

    it('does not send if no client is subscribed to that phone', async () => {
      const { socket, cleanup } = await simulateConnection({ phone: '+27820000000' });

      socket.send.mockClear();

      const message: WebSocketMessage<null> = {
        type: 'ORDER_STATUS_UPDATE',
        payload: null,
        timestamp: new Date().toISOString(),
      };

      broadcastToPhone('+27829999999', message);

      expect(socket.send).not.toHaveBeenCalled();

      cleanup();
    });
  });

  // ── broadcastOrderStatusUpdate() ──────────────────────────────────────────

  describe('broadcastOrderStatusUpdate()', () => {
    it('builds an ORDER_STATUS_UPDATE message and routes it via broadcastToPhone', async () => {
      const { socket, cleanup } = await simulateConnection({ phone: '+27821111111' });

      socket.send.mockClear();

      const payload: OrderStatusUpdatePayload = {
        orderId: 'order-001',
        phone: '+27821111111',
        status: 'READY',
        vendorId: 'vendor-abc',
        eventId: 'event-xyz',
      };

      broadcastOrderStatusUpdate(payload);

      expect(socket.send).toHaveBeenCalledOnce();

      const sent = JSON.parse(socket.send.mock.calls[0][0]);
      expect(sent.type).toBe('ORDER_STATUS_UPDATE');
      expect(sent.payload).toEqual(payload);
      expect(sent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      cleanup();
    });

    it('does not send ORDER_STATUS_UPDATE to a client on a different phone', async () => {
      const { socket, cleanup } = await simulateConnection({ phone: '+27822222222' });

      socket.send.mockClear();

      broadcastOrderStatusUpdate({
        orderId: 'order-002',
        phone: '+27821111111',
        status: 'PENDING',
        vendorId: 'vendor-abc',
      });

      expect(socket.send).not.toHaveBeenCalled();

      cleanup();
    });
  });

  // ── broadcastNewOrder() ────────────────────────────────────────────────────

  describe('broadcastNewOrder()', () => {
    it('builds a NEW_ORDER message and routes it to the vendor subscriber', async () => {
      const { socket, cleanup } = await simulateConnection({ vendorId: 'vendor-new' }, { userId: 'u1', role: 'vendor', vendorId: 'vendor-new' });

      socket.send.mockClear();

      const payload: NewOrderPayload = {
        orderId: 'order-111',
        vendorId: 'vendor-new',
        eventId: 'event-abc',
      };

      broadcastNewOrder(payload);

      expect(socket.send).toHaveBeenCalledOnce();

      const sent = JSON.parse(socket.send.mock.calls[0][0]);
      expect(sent.type).toBe('NEW_ORDER');
      expect(sent.payload).toEqual(payload);
      expect(sent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      cleanup();
    });

    it('does not send NEW_ORDER to a vendor subscriber for a different vendorId', async () => {
      const { socket, cleanup } = await simulateConnection({ vendorId: 'vendor-other' }, { userId: 'u2', role: 'vendor', vendorId: 'vendor-other' });

      socket.send.mockClear();

      broadcastNewOrder({ orderId: 'order-222', vendorId: 'vendor-new' });

      expect(socket.send).not.toHaveBeenCalled();

      cleanup();
    });
  });

  // ── broadcastPriceUpdate() ─────────────────────────────────────────────────

  describe('broadcastPriceUpdate()', () => {
    it('builds a PRICE_UPDATE message with the correct structure', async () => {
      const { socket, cleanup } = await simulateConnection({ eventId: 'event-price' });

      socket.send.mockClear();

      const payload: PriceUpdatePayload = {
        vendorId: 'vendor-abc',
        eventId: 'event-price',
        items: [
          { menuItemId: 'item-1', oldPrice: 80, newPrice: 90, name: 'Burger' },
        ],
      };

      broadcastPriceUpdate(payload);

      expect(socket.send).toHaveBeenCalledOnce();

      const sent = JSON.parse(socket.send.mock.calls[0][0]);
      expect(sent.type).toBe('PRICE_UPDATE');
      expect(sent.payload.vendorId).toBe('vendor-abc');
      expect(sent.payload.eventId).toBe('event-price');
      expect(sent.payload.items).toHaveLength(1);
      expect(sent.payload.items[0]).toMatchObject({ menuItemId: 'item-1', oldPrice: 80, newPrice: 90 });
      expect(sent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      cleanup();
    });

    it('routes PRICE_UPDATE only to clients subscribed to the same eventId', async () => {
      const { socket: match, cleanup: c1 } = await simulateConnection({ eventId: 'event-price' });
      const { socket: noMatch, cleanup: c2 } = await simulateConnection({ eventId: 'event-other' });

      match.send.mockClear();
      noMatch.send.mockClear();

      broadcastPriceUpdate({
        vendorId: 'vendor-abc',
        eventId: 'event-price',
        items: [{ menuItemId: 'item-1', oldPrice: 50, newPrice: 60 }],
      });

      expect(match.send).toHaveBeenCalledOnce();
      expect(noMatch.send).not.toHaveBeenCalled();

      c1(); c2();
    });
  });

  // ── broadcastAvailabilityUpdate() ─────────────────────────────────────────

  describe('broadcastAvailabilityUpdate()', () => {
    it('builds an ITEM_AVAILABILITY_UPDATE message with the correct structure', async () => {
      const { socket, cleanup } = await simulateConnection({ eventId: 'event-avail' });

      socket.send.mockClear();

      const payload: ItemAvailabilityPayload = {
        vendorId: 'vendor-abc',
        eventId: 'event-avail',
        menuItemId: 'item-99',
        eventMenuItemId: 'emi-99',
        available: false,
        availabilityStatus: 'OUT_OF_STOCK',
      };

      broadcastAvailabilityUpdate(payload);

      expect(socket.send).toHaveBeenCalledOnce();

      const sent = JSON.parse(socket.send.mock.calls[0][0]);
      expect(sent.type).toBe('ITEM_AVAILABILITY_UPDATE');
      expect(sent.payload).toEqual(payload);
      expect(sent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      cleanup();
    });

    it('routes ITEM_AVAILABILITY_UPDATE only to matching event subscribers', async () => {
      const { socket: match, cleanup: c1 } = await simulateConnection({ eventId: 'event-avail' });
      const { socket: noMatch, cleanup: c2 } = await simulateConnection({ eventId: 'event-other' });

      match.send.mockClear();
      noMatch.send.mockClear();

      broadcastAvailabilityUpdate({
        vendorId: 'vendor-abc',
        eventId: 'event-avail',
        menuItemId: 'item-99',
        available: true,
        availabilityStatus: 'AVAILABLE',
      });

      expect(match.send).toHaveBeenCalledOnce();
      expect(noMatch.send).not.toHaveBeenCalled();

      c1(); c2();
    });
  });

  // ── broadcastVendorStatus() ────────────────────────────────────────────────

  describe('broadcastVendorStatus()', () => {
    it('builds a VENDOR_STATUS_UPDATE message and routes it via broadcastToVendor', async () => {
      const { socket, cleanup } = await simulateConnection({ vendorId: 'vendor-paused' }, { userId: 'u1', role: 'vendor', vendorId: 'vendor-paused' });

      socket.send.mockClear();

      const payload: VendorStatusPayload = {
        vendorId: 'vendor-paused',
        isPaused: true,
      };

      broadcastVendorStatus(payload);

      expect(socket.send).toHaveBeenCalledOnce();

      const sent = JSON.parse(socket.send.mock.calls[0][0]);
      expect(sent.type).toBe('VENDOR_STATUS_UPDATE');
      expect(sent.payload).toEqual({ vendorId: 'vendor-paused', isPaused: true });
      expect(sent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      cleanup();
    });

    it('does not send VENDOR_STATUS_UPDATE to an unrelated vendor subscriber', async () => {
      const { socket, cleanup } = await simulateConnection({ vendorId: 'vendor-other' }, { userId: 'u2', role: 'vendor', vendorId: 'vendor-other' });

      socket.send.mockClear();

      broadcastVendorStatus({ vendorId: 'vendor-paused', isPaused: false });

      expect(socket.send).not.toHaveBeenCalled();

      cleanup();
    });
  });

  // ── broadcastMenuItemUpdate() ──────────────────────────────────────────────

  describe('broadcastMenuItemUpdate()', () => {
    it('builds a MENU_ITEM_UPDATE message and routes it to the event subscriber', async () => {
      const { socket, cleanup } = await simulateConnection({ eventId: 'event-menu' });

      socket.send.mockClear();

      const payload: MenuItemUpdatePayload = {
        vendorId: 'vendor-abc',
        eventId: 'event-menu',
        menuItemId: 'item-77',
        changes: { name: 'Deluxe Burger', price: 95 },
      };

      broadcastMenuItemUpdate(payload);

      expect(socket.send).toHaveBeenCalledOnce();

      const sent = JSON.parse(socket.send.mock.calls[0][0]);
      expect(sent.type).toBe('MENU_ITEM_UPDATE');
      expect(sent.payload).toEqual(payload);
      expect(sent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      cleanup();
    });
  });

  // ── getConnectionStats() ───────────────────────────────────────────────────

  describe('getConnectionStats()', () => {
    it('returns totalConnections equal to the number of connected clients', async () => {
      const before = getConnectionStats().totalConnections;

      const { cleanup: c1 } = await simulateConnection({ eventId: 'event-stats' });
      const { cleanup: c2 } = await simulateConnection({ vendorId: 'vendor-stats' }, { userId: 'u1', role: 'vendor', vendorId: 'vendor-stats' });

      const stats = getConnectionStats();

      expect(stats.totalConnections).toBe(before + 2);
      expect(stats.byRole).toBeDefined();

      c1(); c2();

      const after = getConnectionStats();
      expect(after.totalConnections).toBe(before);
    });

    it('returns role breakdown in byRole field', async () => {
      const before = getConnectionStats().totalConnections;
      const { cleanup } = await simulateConnection({ eventId: 'event-meta', phone: '+27820000001' });

      const stats = getConnectionStats();
      expect(stats.totalConnections).toBe(before + 1);
      // Unauthenticated connections show as 'anonymous'
      expect(stats.byRole).toBeDefined();

      cleanup();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Subscription message handling
// ══════════════════════════════════════════════════════════════════════════════

describe('WebSocket controller – subscription message handling', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('SUBSCRIBE with eventId adds client to event subscription set', async () => {
    const { socket, cleanup } = await simulateConnection({ eventId: 'event-sub-test' });

    // Clear setup messages (CONNECTED welcome + SUBSCRIBED ack).
    socket.send.mockClear();

    const message: WebSocketMessage<null> = {
      type: 'PRICE_UPDATE',
      payload: null,
      timestamp: new Date().toISOString(),
    };
    broadcastToEvent('event-sub-test', message);

    // Should have received exactly the broadcast message.
    expect(socket.send).toHaveBeenCalledOnce();

    const lastCall = socket.send.mock.calls.at(-1)?.[0];
    const parsed = JSON.parse(lastCall);
    expect(parsed.type).toBe('PRICE_UPDATE');

    cleanup();
  });

  it('SUBSCRIBE with vendorId adds client to vendor subscription set', async () => {
    const { socket, cleanup } = await simulateConnection({ vendorId: 'vendor-sub-test' }, { userId: 'u1', role: 'vendor', vendorId: 'vendor-sub-test' });

    socket.send.mockClear();

    broadcastToVendor('vendor-sub-test', {
      type: 'VENDOR_STATUS_UPDATE',
      payload: null,
      timestamp: new Date().toISOString(),
    });

    expect(socket.send).toHaveBeenCalledOnce();
    const parsed = JSON.parse(socket.send.mock.calls[0][0]);
    expect(parsed.type).toBe('VENDOR_STATUS_UPDATE');

    cleanup();
  });

  it('SUBSCRIBE with phone adds client to phone subscription set', async () => {
    const { socket, cleanup } = await simulateConnection({ phone: '+27820001111' });

    socket.send.mockClear();

    broadcastToPhone('+27820001111', {
      type: 'ORDER_STATUS_UPDATE',
      payload: null,
      timestamp: new Date().toISOString(),
    });

    expect(socket.send).toHaveBeenCalledOnce();
    const parsed = JSON.parse(socket.send.mock.calls[0][0]);
    expect(parsed.type).toBe('ORDER_STATUS_UPDATE');

    cleanup();
  });

  it('client disconnect removes the client from all subscription sets', async () => {
    const { socket, cleanup } = await simulateConnection({ eventId: 'event-disco', vendorId: 'vendor-disco' }, { userId: 'u1', role: 'vendor', vendorId: 'vendor-disco' });

    // Client is connected
    const statsBefore = getConnectionStats().totalConnections;
    expect(statsBefore).toBeGreaterThan(0);

    // Simulate disconnect
    cleanup();

    // Client should no longer be reachable
    socket.send.mockClear();
    broadcastToEvent('event-disco', {
      type: 'PRICE_UPDATE',
      payload: null,
      timestamp: new Date().toISOString(),
    });
    broadcastToVendor('vendor-disco', {
      type: 'VENDOR_STATUS_UPDATE',
      payload: null,
      timestamp: new Date().toISOString(),
    });

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('send a CONNECTED welcome message immediately after connection', async () => {
    const { socket, cleanup } = await simulateConnection();

    // The very first send should be the CONNECTED welcome
    const firstSend = socket.send.mock.calls[0]?.[0];
    expect(firstSend).toBeDefined();
    const parsed = JSON.parse(firstSend);
    expect(parsed.type).toBe('CONNECTED');
    expect(parsed.payload.message).toMatch(/NowNow/i);

    cleanup();
  });

  it('SUBSCRIBE sends a SUBSCRIBED acknowledgement back to the client', async () => {
    const { socket, cleanup } = await simulateConnection({ eventId: 'event-ack' });

    // Calls so far: [CONNECTED, SUBSCRIBED]
    const subbedCall = socket.send.mock.calls.find((call: any[]) => {
      const p = JSON.parse(call[0]);
      return p.type === 'SUBSCRIBED';
    });

    expect(subbedCall).toBeDefined();
    const parsed = JSON.parse(subbedCall![0]);
    expect(parsed.payload).toMatchObject({ eventId: 'event-ack' });

    cleanup();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REST endpoint: GET /ws/stats
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /ws/stats', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with { totalConnections, byRole }', async () => {
    const app = await buildApp(async (fastify) => {
      // Register only the REST stats route (not the full WS plugin which needs
      // the @fastify/websocket upgrade handshake that inject() cannot do).
      fastify.get('/ws/stats', async () => getConnectionStats());
    });

    const res = await app.inject({ method: 'GET', url: '/ws/stats' });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toHaveProperty('totalConnections');
    expect(body).toHaveProperty('byRole');
    expect(typeof body.totalConnections).toBe('number');
    expect(typeof body.byRole).toBe('object');

    await app.close();
  });

  it('totalConnections reflects the current client count', async () => {
    const { cleanup } = await simulateConnection({ eventId: 'event-stat-rest' });

    const app = await buildApp(async (fastify) => {
      fastify.get('/ws/stats', async () => getConnectionStats());
    });

    const res = await app.inject({ method: 'GET', url: '/ws/stats' });
    const body = res.json();

    expect(body.totalConnections).toBeGreaterThan(0);

    cleanup();
    await app.close();
  });
});
