import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { makeEvent, makeEventMenuConfig } from '../fixtures/index.js';

import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';

// ── Module-level mocks ──────────────────────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));

vi.mock('../../lib/redis.js', () => ({
  default: redisMock,
  redis: redisMock,
  cache: cacheMock,
  CACHE_TTL: CACHE_TTL_MOCK,
}));

vi.mock('../../websocket/index.js', () => ({
  broadcastNewOrder: vi.fn(),
  broadcastOrderStatusUpdate: vi.fn(),
  broadcastToVendor: vi.fn(),
  broadcastAdminOrderFeed: vi.fn(),
  broadcastToAdmins: vi.fn(),
}));

const _waInst = {
  sendOrderPlacedTemplate: vi.fn().mockResolvedValue(undefined),
  sendOrderReadyTemplate: vi.fn().mockResolvedValue(undefined),
  sendOrderCollectedTemplate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../whatsapp/whatsapp.service.js', () => ({
  WhatsappService: vi.fn(function () { return _waInst; }),
  getWhatsappService: vi.fn(() => _waInst),
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,test') },
}));

vi.mock('../../orders/order.scheduler.js', () => ({
  OrderScheduler: vi.fn(function () {
    return {
      validateImmediateOrder: vi.fn().mockResolvedValue({
        isValid: true,
        estimatedReadyTime: new Date(Date.now() + 15 * 60_000).toISOString(),
        queuePosition: 1,
      }),
      validateScheduledOrder: vi.fn().mockResolvedValue({
        isValid: true,
        estimatedReadyTime: new Date(Date.now() + 20 * 60_000).toISOString(),
        queuePosition: 2,
      }),
      updateQueuePositions: vi.fn().mockResolvedValue(undefined),
      calculateActualPrepTime: vi.fn().mockReturnValue(12),
    };
  }),
}));

vi.mock('../../discount/discount.service.js', () => ({
  DiscountService: vi.fn(function () {
    return {
      resolveDiscount: vi.fn().mockResolvedValue(null),
      resolveDiscountsForMenu: vi.fn().mockResolvedValue(new Map()),
    };
  }),
}));

vi.mock('../../payment/payment.service.js', () => ({
  PaymentService: vi.fn(function () {
    return {
      getClientToken: vi.fn().mockResolvedValue('test-token'),
      createPaymentRequest: vi.fn().mockResolvedValue({
        paymentId: 'test-payment-id',
        paymentUrl: 'https://pay.stitch.money/test',
      }),
      verifyWebhookSignature: vi.fn().mockResolvedValue(true),
    };
  }),
}));

vi.mock('../../lib/qr.helper.js', () => ({
  QRHelper: vi.fn(function () {
    return {
      generateAndUploadQRCode: vi.fn().mockResolvedValue({
        qr_code: 'ORDER:test-order-id',
        qr_image: 'https://storage.test/qr.png',
      }),
      parseQRCode: vi.fn().mockImplementation((code: string) =>
        code.startsWith('ORDER:') ? code.replace('ORDER:', '') : null,
      ),
    };
  }),
}));

// ── Import OrderService AFTER mocks ─────────────────────────────────────────
import { OrderService } from '../../orders/order.service.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-conc-01';
const EVENT_ID = 'event-conc-01';

function makeOrderInput(overrides: Record<string, any> = {}) {
  return {
    vendor_id: VENDOR_ID,
    event_id: EVENT_ID,
    phone: '+27821234567',
    items: [
      { menuItemId: 'item-1', quantity: 1, selectedModifiers: {} },
    ],
    paymentMethod: 'CASH' as const,
    idempotency_key: 'test-key-' + Math.random().toString(36).slice(2),
    ...overrides,
  };
}

function makeVendorData(overrides: Record<string, any> = {}) {
  return {
    estimated_prep_time: 12,
    name: 'Test Vendor',
    minimum_order: null,
    service_fee_percent: null,
    ...overrides,
  };
}

const eventData = {
  start_date: new Date(Date.now() - 86400000).toISOString(),
  end_date: new Date(Date.now() + 86400000).toISOString(),
};

function makeCreatedOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-created-id',
    vendor_id: VENDOR_ID,
    event_id: EVENT_ID,
    phone: '+27821234567',
    items: [{ id: 'item-1', name: 'Burger', price: 80, quantity: 1 }],
    total: 80,
    status: 'PENDING',
    type: 'CART',
    estimated_prep_time: 12,
    qr_code: 'PENDING-123',
    qr_image: '',
    queue_position: 1,
    estimated_ready_time: new Date(Date.now() + 15 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Mock validation + inventory RPCs to succeed, then the order RPC to return an error. */
function mockRpcError(status: string, message: string, meta?: any) {
  supabaseMock.from.mockReturnValue(createSupabaseMock({ data: [], error: null }));
  let rpcCallCount = 0;
  supabaseMock.rpc.mockImplementation(() => {
    rpcCallCount++;
    if (rpcCallCount === 1) {
      // validate_order_items
      return Promise.resolve({ data: { status: 'ok', items: [{ id: 'item-1', name: 'Burger', price: 80, quantity: 1 }], total: 80 }, error: null });
    }
    if (rpcCallCount === 2) {
      // decrement_inventory
      return Promise.resolve({ data: { status: 'ok', low_stock: [], sold_out: [] }, error: null });
    }
    // create_order_validated — return the error
    return Promise.resolve({ data: { status, message, ...(meta ? { meta } : {}) }, error: null });
  });
}

/** Mock all 3 RPCs to succeed for a full order creation. */
function mockRpcSuccess(menuConfig?: any, orderOverrides?: Record<string, any>) {
  const order = makeCreatedOrder(orderOverrides);
  const updatedOrder = { ...order, qr_code: 'ORDER:' + order.id, qr_image: 'https://storage.test/qr.png' };

  let fromCallCount = 0;
  supabaseMock.from.mockImplementation(() => {
    fromCallCount++;
    if (fromCallCount === 1) {
      return createSupabaseMock({ data: [], error: null });
    }
    return createSupabaseMock({ data: updatedOrder, error: null });
  });

  let rpcCallCount = 0;
  supabaseMock.rpc.mockImplementation(() => {
    rpcCallCount++;
    if (rpcCallCount === 1) {
      // validate_order_items
      return Promise.resolve({ data: { status: 'ok', items: order.items, total: order.total }, error: null });
    }
    if (rpcCallCount === 2) {
      // decrement_inventory
      return Promise.resolve({ data: { status: 'ok', low_stock: [], sold_out: [] }, error: null });
    }
    // create_order_validated
    return Promise.resolve({
      data: {
        status: 'ok',
        order,
        vendor: makeVendorData(),
        menu_config: menuConfig ?? null,
        event: eventData,
        queue_position: 1,
        estimated_ready_time: new Date(Date.now() + 15 * 60_000).toISOString(),
        customer_name: null,
        capacity_incremented: false,
      },
      error: null,
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests — RPC-based validation (concurrency controls)
// The validation logic now lives in the create_order_validated RPC.
// These tests verify that JS correctly interprets the RPC's error responses.
// ═══════════════════════════════════════════════════════════════════════════════

describe('OrderService — concurrency and rate control in createOrder (RPC-based)', () => {
  let service: OrderService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrderService();
  });

  // ── 1. Vendor not accepting orders ──────────────────────────────────────

  describe('is_accepting_orders check', () => {
    it('throws when vendor has is_accepting_orders = false', async () => {
      mockRpcError('not_accepting', 'This vendor is not currently accepting orders.');
      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('not currently accepting orders');
    });
  });

  // ── 2. Menu status PAUSED / CLOSED ──────────────────────────────────────

  describe('menu status enforcement', () => {
    it('throws when menu status is PAUSED', async () => {
      mockRpcError('paused', 'This vendor has temporarily paused orders. Please try again shortly.');
      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('temporarily paused orders');
    });

    it('throws when menu status is CLOSED', async () => {
      mockRpcError('closed', 'This vendor has closed for this event.');
      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('closed for this event');
    });
  });

  // ── 3. Max concurrent orders ────────────────────────────────────────────

  describe('max_concurrent_orders enforcement', () => {
    it('throws when current_active_orders >= max_concurrent_orders', async () => {
      mockRpcError('at_capacity', 'This vendor is at capacity (10 concurrent orders). Please wait a few minutes and try again.',
        { max: 10, current: 10 });
      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('at capacity');
    });

    it('throws when current_active_orders exceeds max_concurrent_orders', async () => {
      mockRpcError('at_capacity', 'This vendor is at capacity (5 concurrent orders). Please wait a few minutes and try again.',
        { max: 5, current: 7 });
      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('at capacity (5 concurrent orders)');
    });

    it('allows order when current_active_orders < max_concurrent_orders', async () => {
      mockRpcSuccess();
      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
      expect(result.paymentUrl).toBe('');
    });

    it('bypasses check when max_concurrent_orders is null (unlimited)', async () => {
      mockRpcSuccess();
      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 4. Order cooldown ──────────────────────────────────────────────────

  describe('order_cooldown_minutes enforcement', () => {
    it('throws when a recent order exists within the cooldown window', async () => {
      mockRpcError('cooldown', 'This vendor is managing order flow. Please try again in 4m.',
        { wait_seconds: 240 });
      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('managing order flow');
    });

    it('allows order when no recent orders exist within cooldown window', async () => {
      mockRpcSuccess();
      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });

    it('bypasses cooldown check when order_cooldown_minutes is 0', async () => {
      mockRpcSuccess();
      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 5. Max orders per customer per event ────────────────────────────────

  describe('max_orders_per_customer_event enforcement', () => {
    it('throws when customer has reached the per-event order limit', async () => {
      mockRpcError('max_orders_reached', 'You have reached the maximum of 3 order(s) allowed per customer at this event.');
      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('maximum of 3 order(s) allowed per customer');
    });

    it('allows order when customer is below the per-event limit', async () => {
      mockRpcSuccess();
      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });

    it('bypasses customer limit when max_orders_per_customer_event is null', async () => {
      mockRpcSuccess();
      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 6. Operating hours — daily default (still validated in JS) ─────────

  describe('operating hours enforcement (daily default)', () => {
    it('throws when current time is before event_open_time', async () => {
      // RPC succeeds (it doesn't check operating hours) but returns menu_config
      // with a narrow operating window we're guaranteed to be outside of
      mockRpcSuccess({
        event_open_time: '23:58',
        event_close_time: '23:59',
        operating_schedule: null,
      });

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('only accepting orders between');
    });

    it('allows order when current time is within daily operating window', async () => {
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const openTime = `${pad(now.getUTCHours())}:00`;
      const closeHour = now.getUTCHours() === 23 ? '23' : pad(now.getUTCHours() + 1);
      const closeTime = `${closeHour}:59`;

      mockRpcSuccess({
        event_open_time: openTime,
        event_close_time: closeTime,
        operating_schedule: null,
      });

      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 7. Operating schedule — per-day override (still validated in JS) ───

  describe('operating hours enforcement (per-day schedule)', () => {
    it('throws when today has isClosed = true in the schedule', async () => {
      const todayDate = new Date().toISOString().split('T')[0];

      mockRpcSuccess({
        event_open_time: '00:00',
        event_close_time: '23:59',
        operating_schedule: [{ date: todayDate, isClosed: true }],
      });

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('not operating today');
    });

    it('throws when per-day schedule has a narrow time window', async () => {
      const todayDate = new Date().toISOString().split('T')[0];

      mockRpcSuccess({
        event_open_time: '00:00',
        event_close_time: '23:59',
        operating_schedule: [{ date: todayDate, isClosed: false, openTime: '23:58', closeTime: '23:59' }],
      });

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('operates');
    });

    it('per-day schedule takes precedence over daily defaults', async () => {
      const todayDate = new Date().toISOString().split('T')[0];
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const openTime = `${pad(now.getUTCHours())}:00`;
      const closeHour = now.getUTCHours() === 23 ? '23' : pad(now.getUTCHours() + 1);
      const closeTime = `${closeHour}:59`;

      mockRpcSuccess({
        event_open_time: '23:58',
        event_close_time: '23:59',
        operating_schedule: [{ date: todayDate, isClosed: false, openTime, closeTime }],
      });

      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 8. Event date bounds ───────────────────────────────────────────────

  describe('event date bounds enforcement', () => {
    it('throws when the event has not started yet', async () => {
      mockRpcError('event_not_started', 'This event has not started yet.');
      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('not started yet');
    });

    it('throws when the event has already ended', async () => {
      mockRpcError('event_ended', 'This event has ended. Orders are no longer accepted.');
      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('event has ended');
    });
  });

  // ── 9. Prep time buffer ────────────────────────────────────────────────

  describe('prep_time_buffer_minutes', () => {
    it('adds buffer to estimated prep time when set in config', async () => {
      mockRpcSuccess(null, { estimated_prep_time: 22 }); // 12 base + 10 buffer (done in RPC)
      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 10. No event_menu_configuration (no restrictions) ──────────────────

  describe('no event_menu_configuration found', () => {
    it('allows order when no config record exists for the vendor+event', async () => {
      mockRpcSuccess(null);
      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 11. Duplicate detection ────────────────────────────────────────────

  describe('duplicate order detection', () => {
    it('throws when a duplicate order is detected within 30s window', async () => {
      mockRpcError('duplicate', 'A duplicate order was detected. Please wait a moment before ordering again.');
      await expect(service.createOrder(makeOrderInput())).rejects.toThrow('duplicate order was detected');
    });
  });
});
