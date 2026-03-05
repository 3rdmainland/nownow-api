import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { makeOrder, makeVendor, makeEvent } from '../fixtures/index.js';
import { OrderStatus, OrderType } from '../../orders/order.types.js';
import { ValidationError } from '../../lib/errors.js';

import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';

// ── Module-level mocks (hoisted before any imports that pull these deps) ──────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock }));

vi.mock('../../lib/redis.js', () => ({
    cache: cacheMock,
    redis: redisMock,
    default: redisMock,
    CACHE_TTL: CACHE_TTL_MOCK,
}));

vi.mock('../../websocket/index.js', () => ({
    broadcastNewOrder: vi.fn(),
    broadcastOrderStatusUpdate: vi.fn(),
    broadcastToVendor: vi.fn(),
}));

const mockSendOrderPlacedTemplate = vi.fn().mockResolvedValue(undefined);
const mockSendOrderReadyTemplate = vi.fn().mockResolvedValue(undefined);
const mockSendOrderCollectedTemplate = vi.fn().mockResolvedValue(undefined);

vi.mock('../../whatsapp/whatsapp.service.js', () => ({
    WhatsappService: vi.fn(function() {
        return {
            sendOrderPlacedTemplate: mockSendOrderPlacedTemplate,
            sendOrderReadyTemplate: mockSendOrderReadyTemplate,
            sendOrderCollectedTemplate: mockSendOrderCollectedTemplate,
        };
    }),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,test') },
}));

// Also mock the scheduler and QRHelper so createOrder tests don't need full setup
vi.mock('../../orders/order.scheduler.js', () => ({
    OrderScheduler: vi.fn(function() {
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
    DiscountService: vi.fn(function() {
        return {
            resolveDiscount: vi.fn().mockResolvedValue(null),
            resolveDiscountsForMenu: vi.fn().mockResolvedValue(new Map()),
        };
    }),
}));

vi.mock('../../lib/qr.helper.js', () => ({
    QRHelper: vi.fn(function() {
        return {
            generateAndUploadQRCode: vi.fn().mockResolvedValue({
                qr_code: 'ORDER:test-order-id',
                qr_image: 'https://storage.test/qr.png',
            }),
            parseQRCode: vi.fn().mockImplementation((code: string) =>
                code.startsWith('ORDER:') ? code.replace('ORDER:', '') : null
            ),
        };
    }),
}));

// ── Import OrderService AFTER mocks are registered ───────────────────────────
import { OrderService } from '../../orders/order.service.js';
import { broadcastOrderStatusUpdate, broadcastNewOrder, broadcastToVendor } from '../../websocket/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Configure supabaseMock.from() to return a builder with the given response. */
function mockFrom(response: { data: any; error: any }) {
    supabaseMock.from.mockReturnValue(createSupabaseMock(response));
}

/** Configure supabaseMock.from() to return a different builder per call. */
function mockFromSequence(...responses: Array<{ data: any; error: any }>) {
    let callCount = 0;
    supabaseMock.from.mockImplementation(() => {
        const response = responses[callCount] ?? responses[responses.length - 1];
        callCount++;
        return createSupabaseMock(response);
    });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('OrderService', () => {
    let service: OrderService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new OrderService();
    });

    // ── getAllOrders ──────────────────────────────────────────────────────────

    describe('getAllOrders', () => {
        it('returns paginated orders when no filters are applied', async () => {
            const orders = [makeOrder(), makeOrder()];
            mockFrom({ data: orders, error: null });

            const result = await service.getAllOrders();

            expect(result.orders).toEqual(orders);
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(result.total).toBe(2);
            expect(result.totalPages).toBe(1);
            expect(supabaseMock.from).toHaveBeenCalledWith('orders');
        });

        it('returns an empty orders array when there are no orders', async () => {
            mockFrom({ data: [], error: null });

            const result = await service.getAllOrders();

            expect(result.orders).toEqual([]);
            expect(result.total).toBe(0);
            expect(result.totalPages).toBe(0);
        });

        it('returns null data as an empty orders array', async () => {
            mockFrom({ data: null, error: null });

            const result = await service.getAllOrders();

            expect(result.orders).toEqual([]);
        });

        it('filters by vendorId when provided', async () => {
            const vendor = makeVendor();
            const orders = [makeOrder({ vendor_id: vendor.id })];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getAllOrders({ vendorId: vendor.id });

            expect(result.orders).toEqual(orders);
            expect(builder.eq).toHaveBeenCalledWith('vendor_id', vendor.id);
        });

        it('filters by eventId when provided', async () => {
            const event = makeEvent();
            const orders = [makeOrder({ event_id: event.id })];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getAllOrders({ eventId: event.id });

            expect(result.orders).toEqual(orders);
            expect(builder.eq).toHaveBeenCalledWith('event_id', event.id);
        });

        it('filters by status when provided', async () => {
            const orders = [makeOrder({ status: OrderStatus.PENDING })];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getAllOrders({ status: OrderStatus.PENDING });

            expect(result.orders).toEqual(orders);
            expect(builder.eq).toHaveBeenCalledWith('status', OrderStatus.PENDING);
        });

        it('respects explicit page and pageSize values', async () => {
            const orders = [makeOrder()];
            const builder = createSupabaseMock({ data: orders, error: null, count: 25 });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getAllOrders({ pagination: { page: 2, pageSize: 5 } });

            expect(result.page).toBe(2);
            expect(result.pageSize).toBe(5);
            expect(result.total).toBe(25);
            expect(result.totalPages).toBe(5);
            expect(builder.range).toHaveBeenCalledWith(5, 9);
        });

        it('throws when supabase returns an error', async () => {
            mockFrom({ data: null, error: { message: 'DB failure' } });

            await expect(service.getAllOrders()).rejects.toThrow('Failed to fetch orders');
        });
    });

    // ── getOrderById ──────────────────────────────────────────────────────────

    describe('getOrderById', () => {
        it('returns the order when found', async () => {
            const order = makeOrder();
            mockFrom({ data: order, error: null });

            const result = await service.getOrderById(order.id);

            expect(result).toEqual(order);
        });

        it('returns null when data is null and no error', async () => {
            mockFrom({ data: null, error: null });

            const result = await service.getOrderById('nonexistent-id');

            expect(result).toBeNull();
        });

        it('throws when supabase returns an error', async () => {
            mockFrom({ data: null, error: { message: 'not found' } });

            await expect(service.getOrderById('bad-id')).rejects.toThrow('Failed to fetch order');
        });
    });

    // ── getRecentOrders ───────────────────────────────────────────────────────

    describe('getRecentOrders', () => {
        it('returns a limited list of recent orders with default limit of 10', async () => {
            const orders = Array.from({ length: 10 }, () => makeOrder());
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getRecentOrders();

            expect(result).toEqual(orders);
            expect(builder.limit).toHaveBeenCalledWith(10);
        });

        it('respects a custom limit', async () => {
            const orders = [makeOrder(), makeOrder(), makeOrder()];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getRecentOrders(3);

            expect(result).toHaveLength(3);
            expect(builder.limit).toHaveBeenCalledWith(3);
        });

        it('throws when supabase returns an error', async () => {
            mockFrom({ data: null, error: { message: 'connection refused' } });

            await expect(service.getRecentOrders()).rejects.toThrow('Failed to fetch recent orders');
        });
    });

    // ── getOrdersByVendor ─────────────────────────────────────────────────────

    describe('getOrdersByVendor', () => {
        it('returns paginated orders belonging to the given vendor', async () => {
            const vendor = makeVendor();
            const orders = [makeOrder({ vendor_id: vendor.id }), makeOrder({ vendor_id: vendor.id })];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getOrdersByVendor(vendor.id);

            expect(result.orders).toEqual(orders);
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(builder.eq).toHaveBeenCalledWith('vendor_id', vendor.id);
        });

        it('returns empty orders array when vendor has no orders', async () => {
            mockFrom({ data: [], error: null });

            const result = await service.getOrdersByVendor('vendor-with-no-orders');

            expect(result.orders).toEqual([]);
            expect(result.total).toBe(0);
            expect(result.totalPages).toBe(0);
        });

        it('throws when supabase returns an error', async () => {
            mockFrom({ data: null, error: { message: 'timeout' } });

            await expect(service.getOrdersByVendor('v1')).rejects.toThrow('Failed to fetch vendor orders');
        });
    });

    // ── getOrdersByEvent ──────────────────────────────────────────────────────

    describe('getOrdersByEvent', () => {
        it('returns paginated orders belonging to the given event', async () => {
            const event = makeEvent();
            const orders = [makeOrder({ event_id: event.id })];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getOrdersByEvent(event.id);

            expect(result.orders).toEqual(orders);
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(builder.eq).toHaveBeenCalledWith('event_id', event.id);
        });

        it('returns empty orders array when event has no orders', async () => {
            mockFrom({ data: null, error: null });

            const result = await service.getOrdersByEvent('empty-event');

            expect(result.orders).toEqual([]);
            expect(result.total).toBe(0);
            expect(result.totalPages).toBe(0);
        });

        it('throws when supabase returns an error', async () => {
            mockFrom({ data: null, error: { message: 'DB error' } });

            await expect(service.getOrdersByEvent('e1')).rejects.toThrow('Failed to fetch event orders');
        });
    });

    // ── getOrdersByPhone ──────────────────────────────────────────────────────

    describe('getOrdersByPhone', () => {
        it('returns paginated orders for a given phone number', async () => {
            const phone = '0812345678';
            const orders = [makeOrder({ phone }), makeOrder({ phone })];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getOrdersByPhone(phone);

            expect(result.orders).toEqual(orders);
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(builder.eq).toHaveBeenCalledWith('phone', phone);
        });

        it('returns empty orders array when no orders found for phone', async () => {
            mockFrom({ data: [], error: null });

            const result = await service.getOrdersByPhone('0800000000');

            expect(result.orders).toEqual([]);
            expect(result.total).toBe(0);
        });

        it('throws when supabase returns an error', async () => {
            mockFrom({ data: null, error: { message: 'error' } });

            await expect(service.getOrdersByPhone('0812345678')).rejects.toThrow('Failed to fetch orders by phone');
        });
    });

    // ── getOrdersByStatus ─────────────────────────────────────────────────────

    describe('getOrdersByStatus', () => {
        it('returns paginated status-filtered orders', async () => {
            const orders = [makeOrder({ status: OrderStatus.PREPARING }), makeOrder({ status: OrderStatus.PREPARING })];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getOrdersByStatus(OrderStatus.PREPARING);

            expect(result.orders).toEqual(orders);
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(builder.eq).toHaveBeenCalledWith('status', OrderStatus.PREPARING);
        });

        it('returns empty orders array when no orders match the status', async () => {
            mockFrom({ data: [], error: null });

            const result = await service.getOrdersByStatus(OrderStatus.COLLECTED);

            expect(result.orders).toEqual([]);
            expect(result.total).toBe(0);
        });

        it('throws when supabase returns an error', async () => {
            mockFrom({ data: null, error: { message: 'query failed' } });

            await expect(service.getOrdersByStatus(OrderStatus.PENDING)).rejects.toThrow('Failed to fetch orders by status');
        });
    });

    // ── getOrderStats ─────────────────────────────────────────────────────────

    describe('getOrderStats', () => {
        it('returns correct aggregated stats for all orders', async () => {
            const orders = [
                makeOrder({ total: 100, status: OrderStatus.PENDING, items: [{ name: 'Burger', quantity: 2, price: 50, id: '1', vendorId: 'v1', vendorName: 'V' }], payment_method: 'CASH' }),
                makeOrder({ total: 200, status: OrderStatus.COLLECTED, items: [{ name: 'Burger', quantity: 1, price: 200, id: '2', vendorId: 'v1', vendorName: 'V' }], payment_method: 'CARD' }),
                makeOrder({ total: 150, status: OrderStatus.COLLECTED, items: [{ name: 'Pizza', quantity: 5, price: 30, id: '3', vendorId: 'v1', vendorName: 'V' }], payment_method: 'CASH' }),
            ];
            mockFrom({ data: orders, error: null });

            const result = await service.getOrderStats();

            expect(result.totalOrders).toBe(3);
            expect(result.totalRevenue).toBeCloseTo(450, 2);
            expect(result.averageOrderValue).toBeCloseTo(150, 2);
            expect(result.ordersByStatus[OrderStatus.PENDING]).toBe(1);
            expect(result.ordersByStatus[OrderStatus.COLLECTED]).toBe(2);
            // New fields
            expect(result.grossSales).toBeCloseTo(450, 2);
            expect(result.collectedRevenue).toBeCloseTo(350, 2);
            expect(result.cancelledCount).toBe(0);
            expect(result.cancelledValue).toBe(0);
            expect(result.topItem).toEqual({ name: 'Pizza', qty: 5 });
            expect(result.paymentBreakdown).toEqual({ CASH: 250, CARD: 200 });
        });

        it('returns correct stats when cancelled orders exist', async () => {
            const orders = [
                makeOrder({ total: 100, status: OrderStatus.COLLECTED, items: [{ name: 'Burger', quantity: 1, price: 100, id: '1', vendorId: 'v1', vendorName: 'V' }], payment_method: 'CASH' }),
                makeOrder({ total: 50, status: OrderStatus.CANCELLED, items: [{ name: 'Fries', quantity: 2, price: 25, id: '2', vendorId: 'v1', vendorName: 'V' }], payment_method: 'CASH' }),
            ];
            // getOrderStats makes 2 parallel queries: summaryQuery (all orders) and
            // itemsQuery (non-cancelled only, via .neq('status','CANCELLED')).
            // The mock doesn't actually filter, so we use mockFromSequence to return
            // the correct subset for each query.
            mockFromSequence(
                { data: orders, error: null },              // summaryQuery – all orders
                { data: [orders[0]], error: null },          // itemsQuery  – non-cancelled only
            );

            const result = await service.getOrderStats();

            expect(result.totalOrders).toBe(2);
            expect(result.grossSales).toBeCloseTo(100, 2);
            expect(result.collectedRevenue).toBeCloseTo(100, 2);
            expect(result.cancelledCount).toBe(1);
            expect(result.cancelledValue).toBeCloseTo(50, 2);
            expect(result.topItem).toEqual({ name: 'Burger', qty: 1 });
            // Cancelled orders excluded from paymentBreakdown
            expect(result.paymentBreakdown).toEqual({ CASH: 100 });
        });

        it('returns zero averageOrderValue when there are no orders', async () => {
            mockFrom({ data: [], error: null });

            const result = await service.getOrderStats();

            expect(result.totalOrders).toBe(0);
            expect(result.totalRevenue).toBe(0);
            expect(result.averageOrderValue).toBe(0);
            expect(result.ordersByStatus).toEqual({});
            expect(result.grossSales).toBe(0);
            expect(result.collectedRevenue).toBe(0);
            expect(result.cancelledCount).toBe(0);
            expect(result.cancelledValue).toBe(0);
            expect(result.topItem).toBeNull();
            expect(result.paymentBreakdown).toEqual({});
        });

        it('filters by vendorId when provided', async () => {
            const orders = [makeOrder({ total: 80 })];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getOrderStats('vendor-123');

            expect(builder.eq).toHaveBeenCalledWith('vendor_id', 'vendor-123');
            expect(result.totalOrders).toBe(1);
        });

        it('filters by eventId when provided', async () => {
            const orders = [makeOrder({ total: 80 })];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.getOrderStats(undefined, 'event-456');

            expect(builder.eq).toHaveBeenCalledWith('event_id', 'event-456');
        });

        it('throws when supabase returns an error', async () => {
            mockFrom({ data: null, error: { message: 'connection failed' } });

            await expect(service.getOrderStats()).rejects.toThrow('Failed to fetch order stats');
        });
    });

    // ── deleteOrder ───────────────────────────────────────────────────────────

    describe('deleteOrder', () => {
        it('calls supabase delete and resolves without error', async () => {
            const builder = createSupabaseMock({ data: null, error: null });
            supabaseMock.from.mockReturnValue(builder);

            await expect(service.deleteOrder('order-id-123')).resolves.toBeUndefined();
            expect(builder.delete).toHaveBeenCalled();
            expect(builder.eq).toHaveBeenCalledWith('id', 'order-id-123');
        });

        it('throws when supabase returns an error (not found / DB failure)', async () => {
            mockFrom({ data: null, error: { message: 'Row not found' } });

            await expect(service.deleteOrder('bad-id')).rejects.toThrow('Failed to delete order');
        });
    });

    // ── updateOrderStatus ─────────────────────────────────────────────────────

    describe('updateOrderStatus', () => {
        it('transitions PENDING → PREPARING successfully', async () => {
            const currentOrder = makeOrder({ status: OrderStatus.PENDING });
            const updatedOrder = { ...currentOrder, status: OrderStatus.PREPARING, prepared_at: new Date().toISOString() };

            mockFromSequence(
                { data: currentOrder, error: null },   // fetch current order
                { data: updatedOrder, error: null },    // update call
                { data: [], error: null },              // updateQueuePositions - pending orders
            );

            const result = await service.updateOrderStatus(currentOrder.id, OrderStatus.PREPARING);

            expect(result.status).toBe(OrderStatus.PREPARING);
        });

        it('transitions PENDING → CANCELLED successfully', async () => {
            const currentOrder = makeOrder({ status: OrderStatus.PENDING });
            const updatedOrder = { ...currentOrder, status: OrderStatus.CANCELLED };

            mockFromSequence(
                { data: currentOrder, error: null },
                { data: updatedOrder, error: null },
                { data: [], error: null }, // updateQueuePositions not called for CANCELLED, but extra mock is fine
            );

            const result = await service.updateOrderStatus(currentOrder.id, OrderStatus.CANCELLED);

            expect(result.status).toBe(OrderStatus.CANCELLED);
        });

        it('transitions COLLECTING → COLLECTED successfully', async () => {
            // The service has no "COLLECTING" status; READY → COLLECTED is the real path
            const currentOrder = makeOrder({ status: OrderStatus.READY });
            const updatedOrder = { ...currentOrder, status: OrderStatus.COLLECTED, collected_at: new Date().toISOString() };

            mockFromSequence(
                { data: currentOrder, error: null },
                { data: updatedOrder, error: null },
                { data: [], error: null }, // updateQueuePositions (called for COLLECTED)
            );

            const result = await service.updateOrderStatus(currentOrder.id, OrderStatus.COLLECTED);

            expect(result.status).toBe(OrderStatus.COLLECTED);
        });

        it('throws ValidationError when cancelling a non-PENDING order', async () => {
            const currentOrder = makeOrder({ status: OrderStatus.PREPARING });
            mockFrom({ data: currentOrder, error: null });

            await expect(
                service.updateOrderStatus(currentOrder.id, OrderStatus.CANCELLED)
            ).rejects.toThrow(ValidationError);
        });

        it('throws ValidationError with message about PENDING status for CANCELLED attempt', async () => {
            const currentOrder = makeOrder({ status: OrderStatus.READY });
            mockFrom({ data: currentOrder, error: null });

            await expect(
                service.updateOrderStatus(currentOrder.id, OrderStatus.CANCELLED)
            ).rejects.toThrow('Order can only be cancelled before it starts preparing');
        });

        it('throws when the order is not found (fetch returns error)', async () => {
            mockFrom({ data: null, error: { message: 'No rows returned' } });

            await expect(
                service.updateOrderStatus('nonexistent', OrderStatus.PREPARING)
            ).rejects.toThrow('Failed to fetch order');
        });

        it('sends WhatsApp sendOrderReadyTemplate when status becomes READY', async () => {
            // The service guards WhatsApp calls with NODE_ENV !== 'test' and WA_ACCESS_TOKEN
            const originalNodeEnv = process.env.NODE_ENV;
            const originalToken = process.env.WA_ACCESS_TOKEN;
            process.env.NODE_ENV = 'development';
            process.env.WA_ACCESS_TOKEN = 'test-token';

            try {
                const vendor = makeVendor({ name: 'Burger Palace' });
                const currentOrder = makeOrder({ status: OrderStatus.PREPARING, phone: '0812345678', vendor_id: vendor.id, prepared_at: new Date().toISOString() });
                const updatedOrder = { ...currentOrder, status: OrderStatus.READY, ready_at: new Date().toISOString() };

                mockFromSequence(
                    { data: currentOrder, error: null },   // fetch current order
                    { data: updatedOrder, error: null },   // update call
                    { data: [], error: null },             // updateQueuePositions - pending orders
                    { data: vendor, error: null },         // fetch vendor for WhatsApp
                );

                await service.updateOrderStatus(currentOrder.id, OrderStatus.READY);

                // WhatsApp is fire-and-forget, so we need to flush the microtask queue
                await new Promise((r) => setTimeout(r, 0));

                expect(mockSendOrderReadyTemplate).toHaveBeenCalledWith(
                    currentOrder.phone,
                    expect.objectContaining({ orderId: String(updatedOrder.id) })
                );
            } finally {
                process.env.NODE_ENV = originalNodeEnv;
                process.env.WA_ACCESS_TOKEN = originalToken;
            }
        });

        it('broadcasts via broadcastOrderStatusUpdate after a status update', async () => {
            const currentOrder = makeOrder({ status: OrderStatus.PENDING, phone: '0812345678' });
            const updatedOrder = { ...currentOrder, status: OrderStatus.PREPARING };

            mockFromSequence(
                { data: currentOrder, error: null },
                { data: updatedOrder, error: null },
                { data: [], error: null }, // updateQueuePositions
            );

            await service.updateOrderStatus(currentOrder.id, OrderStatus.PREPARING);

            expect(broadcastOrderStatusUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderId: updatedOrder.id,
                    status: OrderStatus.PREPARING,
                })
            );
        });

        it('broadcasts via broadcastToVendor after a status update', async () => {
            const currentOrder = makeOrder({ status: OrderStatus.PENDING, phone: '0812345678' });
            const updatedOrder = { ...currentOrder, status: OrderStatus.PREPARING };

            mockFromSequence(
                { data: currentOrder, error: null },
                { data: updatedOrder, error: null },
                { data: [], error: null }, // updateQueuePositions
            );

            await service.updateOrderStatus(currentOrder.id, OrderStatus.PREPARING);

            expect(broadcastToVendor).toHaveBeenCalledWith(
                updatedOrder.vendor_id,
                expect.objectContaining({ type: 'ORDER_STATUS_UPDATE' })
            );
        });
    });

    // ── searchOrders ──────────────────────────────────────────────────────────

    describe('searchOrders', () => {
        it('returns paginated matching orders for a search term', async () => {
            const orders = [makeOrder({ phone: '0812345678' })];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.searchOrders('0812345678');

            expect(result.orders).toEqual(orders);
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(builder.or).toHaveBeenCalledWith(
                expect.stringContaining('0812345678')
            );
        });

        it('filters by eventId when provided alongside the search term', async () => {
            const event = makeEvent();
            const orders = [makeOrder({ event_id: event.id })];
            const builder = createSupabaseMock({ data: orders, error: null });
            supabaseMock.from.mockReturnValue(builder);

            const result = await service.searchOrders('burger', event.id);

            expect(result.orders).toEqual(orders);
            expect(builder.eq).toHaveBeenCalledWith('event_id', event.id);
        });

        it('returns empty orders array when no orders match', async () => {
            mockFrom({ data: [], error: null });

            const result = await service.searchOrders('zzz-no-match');

            expect(result.orders).toEqual([]);
            expect(result.total).toBe(0);
        });

        it('sanitizes PostgREST metacharacters in search term', async () => {
            const builder = createSupabaseMock({ data: [], error: null });
            supabaseMock.from.mockReturnValue(builder);

            await service.searchOrders('test%_value');

            expect(builder.or).toHaveBeenCalledWith(
                expect.stringContaining('test\\%\\_value')
            );
        });

        it('throws when supabase returns an error', async () => {
            mockFrom({ data: null, error: { message: 'search failed' } });

            await expect(service.searchOrders('burger')).rejects.toThrow('Failed to search orders');
        });
    });
});
