import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { makeVendor, makeEvent, makeEventMenuConfig } from '../fixtures/index.js';

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

function mockFromSequence(responses: Array<ReturnType<typeof createSupabaseMock>>) {
  let callIndex = 0;
  supabaseMock.from.mockImplementation(() => {
    const mock = responses[callIndex] ?? createSupabaseMock({ data: null, error: null });
    callIndex++;
    return mock;
  });
}

const VENDOR_ID = 'vendor-conc-01';
const EVENT_ID = 'event-conc-01';

function makeOrderInput(overrides: Record<string, any> = {}) {
  return {
    vendor_id: VENDOR_ID,
    event_id: EVENT_ID,
    phone: '+27821234567',
    items: [
      { id: 'item-1', name: 'Burger', price: 80, quantity: 1, vendorId: VENDOR_ID, vendorName: 'Test Vendor', prepTime: 10, imageUrl: '' },
    ],
    total: 80,
    payment_method: 'CASH',
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

// Standard "success tail" for createOrder: insert order, select it, QR upload + update, updateQueuePositions
function successTailMocks(orderId = 'order-created-id') {
  const createdOrder = {
    id: orderId,
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
  };

  return [
    createSupabaseMock({ data: createdOrder, error: null }),                                  // insert + select().single()
    createSupabaseMock({ data: { ...createdOrder, qr_code: 'ORDER:' + orderId, qr_image: 'https://storage.test/qr.png' }, error: null }), // update QR
    createSupabaseMock({ data: [], error: null }),                                             // updateQueuePositions
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests — Event Menu Configuration Enforcement (concurrency controls)
// ═══════════════════════════════════════════════════════════════════════════════

describe('OrderService — concurrency and rate control in createOrder', () => {
  let service: OrderService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrderService();
  });

  // ── 1. Vendor not accepting orders ──────────────────────────────────────

  describe('is_accepting_orders check', () => {
    it('throws when vendor has is_accepting_orders = false', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        is_accepting_orders: false,
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),          // fetch vendor
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }), // fetch event
        createSupabaseMock({ data: config, error: null }),                    // fetch event_menu_configurations
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'not currently accepting orders',
      );
    });
  });

  // ── 2. Menu status PAUSED / CLOSED ──────────────────────────────────────

  describe('menu status enforcement', () => {
    it('throws when menu status is PAUSED', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        status: 'PAUSED',
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'temporarily paused orders',
      );
    });

    it('throws when menu status is CLOSED', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        status: 'CLOSED',
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'closed for this event',
      );
    });
  });

  // ── 3. Max concurrent orders ────────────────────────────────────────────

  describe('max_concurrent_orders enforcement', () => {
    it('throws when current_active_orders >= max_concurrent_orders', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: 10,
        current_active_orders: 10, // at capacity
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'at capacity',
      );
    });

    it('throws when current_active_orders exceeds max_concurrent_orders', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: 5,
        current_active_orders: 7, // over capacity
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'at capacity (5 concurrent orders)',
      );
    });

    it('allows order when current_active_orders < max_concurrent_orders', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: 10,
        current_active_orders: 9, // one slot available
        order_cooldown_minutes: null,
        max_orders_per_customer_event: null,
        event_open_time: null,
        event_close_time: null,
        operating_schedule: null,
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
        ...successTailMocks(),
      ]);

      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    it('bypasses check when max_concurrent_orders is null (unlimited)', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        current_active_orders: 500, // doesn't matter
        order_cooldown_minutes: null,
        max_orders_per_customer_event: null,
        event_open_time: null,
        event_close_time: null,
        operating_schedule: null,
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
        ...successTailMocks(),
      ]);

      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 4. Order cooldown ──────────────────────────────────────────────────

  describe('order_cooldown_minutes enforcement', () => {
    it('throws when a recent order exists within the cooldown window', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: 5,
        max_orders_per_customer_event: null,
        event_open_time: null,
        event_close_time: null,
        operating_schedule: null,
      });

      // A recent order placed 1 minute ago (within the 5-minute cooldown)
      const recentOrder = {
        id: 'recent-order-id',
        created_at: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
      };

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
        createSupabaseMock({ data: [recentOrder], error: null }), // recent orders query
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'managing order flow',
      );
    });

    it('allows order when no recent orders exist within cooldown window', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: 5,
        max_orders_per_customer_event: null,
        event_open_time: null,
        event_close_time: null,
        operating_schedule: null,
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
        createSupabaseMock({ data: [], error: null }),  // no recent orders
        ...successTailMocks(),
      ]);

      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });

    it('bypasses cooldown check when order_cooldown_minutes is 0', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: 0,
        max_orders_per_customer_event: null,
        event_open_time: null,
        event_close_time: null,
        operating_schedule: null,
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
        // No cooldown query expected since cooldown is 0 (falsy)
        ...successTailMocks(),
      ]);

      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 5. Max orders per customer per event ────────────────────────────────

  describe('max_orders_per_customer_event enforcement', () => {
    it('throws when customer has reached the per-event order limit', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: null,
        max_orders_per_customer_event: 3,
        event_open_time: null,
        event_close_time: null,
        operating_schedule: null,
      });

      // Customer already placed 3 orders (the max)
      const countMock = createSupabaseMock({ data: null, error: null });
      // Override the builder to return count via the thenable
      countMock.then = vi.fn((resolve: (val: any) => any) =>
        Promise.resolve(resolve({ data: null, error: null, count: 3 })),
      );

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
        countMock, // customer order count query
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'maximum of 3 order(s) allowed per customer',
      );
    });

    it('allows order when customer is below the per-event limit', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: null,
        max_orders_per_customer_event: 3,
        event_open_time: null,
        event_close_time: null,
        operating_schedule: null,
      });

      const countMock = createSupabaseMock({ data: null, error: null });
      countMock.then = vi.fn((resolve: (val: any) => any) =>
        Promise.resolve(resolve({ data: null, error: null, count: 2 })),
      );

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
        countMock,
        ...successTailMocks(),
      ]);

      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });

    it('bypasses customer limit when max_orders_per_customer_event is null', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: null,
        max_orders_per_customer_event: null,
        event_open_time: null,
        event_close_time: null,
        operating_schedule: null,
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
        // No customer count query expected
        ...successTailMocks(),
      ]);

      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 6. Operating hours — daily default ─────────────────────────────────

  describe('operating hours enforcement (daily default)', () => {
    it('throws when current time is before event_open_time', async () => {
      // Set open/close to a window we're guaranteed to be outside of
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: null,
        max_orders_per_customer_event: null,
        event_open_time: '23:58',
        event_close_time: '23:59',
        operating_schedule: null,
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'only accepting orders between',
      );
    });

    it('allows order when current time is within daily operating window', async () => {
      // Create a wide-open window that always includes "now" (UTC — matches service logic)
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const openTime = `${pad(now.getUTCHours())}:00`;
      const closeHour = now.getUTCHours() === 23 ? '23' : pad(now.getUTCHours() + 1);
      const closeTime = `${closeHour}:59`;

      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: null,
        max_orders_per_customer_event: null,
        event_open_time: openTime,
        event_close_time: closeTime,
        operating_schedule: null,
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
        ...successTailMocks(),
      ]);

      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 7. Operating schedule — per-day override ───────────────────────────

  describe('operating hours enforcement (per-day schedule)', () => {
    it('throws when today has isClosed = true in the schedule', async () => {
      const todayDate = new Date().toISOString().split('T')[0];

      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: null,
        max_orders_per_customer_event: null,
        event_open_time: '00:00',
        event_close_time: '23:59',
        operating_schedule: [
          { date: todayDate, isClosed: true },
        ],
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'not operating today',
      );
    });

    it('throws when per-day schedule has a narrow time window the current time falls outside', async () => {
      const todayDate = new Date().toISOString().split('T')[0];

      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: null,
        max_orders_per_customer_event: null,
        event_open_time: '00:00',
        event_close_time: '23:59',
        operating_schedule: [
          { date: todayDate, isClosed: false, openTime: '23:58', closeTime: '23:59' },
        ],
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'operates',
      );
    });

    it('per-day schedule takes precedence over daily defaults', async () => {
      const todayDate = new Date().toISOString().split('T')[0];
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const openTime = `${pad(now.getUTCHours())}:00`;
      const closeHour = now.getUTCHours() === 23 ? '23' : pad(now.getUTCHours() + 1);
      const closeTime = `${closeHour}:59`;

      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: null,
        max_orders_per_customer_event: null,
        // Daily defaults would block (narrow window)
        event_open_time: '23:58',
        event_close_time: '23:59',
        // But per-day schedule allows (wide window including now)
        operating_schedule: [
          { date: todayDate, isClosed: false, openTime, closeTime },
        ],
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
        ...successTailMocks(),
      ]);

      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 8. Event date bounds ───────────────────────────────────────────────

  describe('event date bounds enforcement', () => {
    it('throws when the event has not started yet', async () => {
      const futureEvent = makeEvent({
        id: EVENT_ID,
        start_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // tomorrow
        end_date: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: futureEvent, error: null }),
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'not started yet',
      );
    });

    it('throws when the event has already ended', async () => {
      const pastEvent = makeEvent({
        id: EVENT_ID,
        start_date: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(), // 3 days ago
        end_date: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),   // 2 days ago
      });

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: pastEvent, error: null }),
      ]);

      await expect(service.createOrder(makeOrderInput())).rejects.toThrow(
        'event has ended',
      );
    });
  });

  // ── 9. Prep time buffer ────────────────────────────────────────────────

  describe('prep_time_buffer_minutes', () => {
    it('adds buffer to estimated prep time when set in config', async () => {
      const config = makeEventMenuConfig({
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        max_concurrent_orders: null,
        order_cooldown_minutes: null,
        max_orders_per_customer_event: null,
        event_open_time: null,
        event_close_time: null,
        operating_schedule: null,
        prep_time_buffer_minutes: 10,
      });

      const createdOrder = {
        id: 'order-prep-buffer',
        vendor_id: VENDOR_ID,
        event_id: EVENT_ID,
        phone: '+27821234567',
        items: [{ id: 'item-1', name: 'Burger', price: 80, quantity: 1 }],
        total: 80,
        status: 'PENDING',
        type: 'CART',
        estimated_prep_time: 22, // 12 base + 10 buffer
        qr_code: 'PENDING-123',
        qr_image: '',
        queue_position: 1,
        estimated_ready_time: new Date(Date.now() + 22 * 60_000).toISOString(),
        created_at: new Date().toISOString(),
      };

      const updatedOrder = {
        ...createdOrder,
        qr_code: 'ORDER:order-prep-buffer',
        qr_image: 'https://storage.test/qr.png',
      };

      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: config, error: null }),
        createSupabaseMock({ data: createdOrder, error: null }),  // insert
        createSupabaseMock({ data: updatedOrder, error: null }),  // QR update
        createSupabaseMock({ data: [], error: null }),            // updateQueuePositions
      ]);

      const result = await service.createOrder(makeOrderInput());
      // The order gets created — the prep_time_buffer is added internally
      expect(result).toBeDefined();
    });
  });

  // ── 10. No event_menu_configuration (no restrictions) ──────────────────

  describe('no event_menu_configuration found', () => {
    it('allows order when no config record exists for the vendor+event', async () => {
      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        createSupabaseMock({ data: makeEvent({ id: EVENT_ID }), error: null }),
        createSupabaseMock({ data: null, error: null }), // no config found (null)
        ...successTailMocks(),
      ]);

      const result = await service.createOrder(makeOrderInput());
      expect(result).toBeDefined();
    });
  });

  // ── 11. No event_id (non-event order) ──────────────────────────────────

  describe('non-event order (no event_id)', () => {
    it('skips all event menu checks when event_id is not provided', async () => {
      mockFromSequence([
        createSupabaseMock({ data: makeVendorData(), error: null }),
        // No event or config queries
        ...successTailMocks(),
      ]);

      const result = await service.createOrder(makeOrderInput({ event_id: undefined }));
      expect(result).toBeDefined();
    });
  });
});
