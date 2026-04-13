import {Order, OrderItem, OrderStatus, OrderType, PaginationParams, PaginatedResponse, OrderStats, TimeSeriesGranularity, TimeSeriesStats, TimeSeriesBucket, TimeSeriesSummary, PreviousPeriodSummary, RefundOrderDto, CreateOrderItemInput, ValidatedOrderResult, InventoryResult} from "./order.types";
import {supabase, safeQuery} from "../lib/supabase";
import { getWhatsappService } from "../whatsapp/whatsapp.service";
import { QRHelper } from '../lib/qr.helper';
import { OrderScheduler } from './order.scheduler';
import { broadcastOrderStatusUpdate, broadcastNewOrder, broadcastToVendor, broadcastAdminOrderFeed, broadcastToAdmins } from "../websocket";
import { DiscountService } from "../discount/discount.service.js";
import { paymentService } from "../payment/payment.service.js";
import { ValidationError, NotFoundError, ForbiddenError, TooManyRequestsError, ConflictError } from "../lib/errors.js";
import { cache, CACHE_TTL } from "../lib/redis";
import { sendEmail } from "../lib/email.js";

/**
 * Ensure order.items is a parsed array.
 * Supabase may return JSONB columns as strings in some cases.
 */
function normalizeOrderItems<T extends Record<string, any>>(order: T): T {
    if (order && typeof (order as any).items === 'string') {
        try { (order as any).items = JSON.parse((order as any).items); } catch { /* leave as-is */ }
    }
    return order;
}

function normalizeOrders<T extends Record<string, any>>(orders: T[]): T[] {
    return orders.map(normalizeOrderItems);
}

export class OrderService {
    private scheduler: OrderScheduler;

    constructor() {
        this.scheduler = new OrderScheduler();
    }

    /**
     * Server-side price calculation + modifier validation.
     * Calls the validate_order_items RPC which fetches menu prices from DB,
     * validates modifiers, and returns server-calculated prices.
     */
    async validateOrderItems(vendorId: string, eventId: string, items: CreateOrderItemInput[]): Promise<ValidatedOrderResult> {
        const { data, error } = await supabase.rpc('validate_order_items', {
            p_vendor_id: vendorId,
            p_event_id: eventId,
            p_items: items,
        });

        if (error) throw new ValidationError(`Order validation failed: ${error.message}`);

        if (data.status === 'validation_error') {
            throw new ValidationError(data.errors.join('; '));
        }

        return {
            items: data.items as OrderItem[],
            total: Number(data.total),
        };
    }

    /**
     * Atomic inventory decrement for order items.
     * Decrements stock for tracked items and increments per-item order counts.
     * Returns low stock / sold out alerts for vendor notifications.
     */
    async decrementInventory(vendorId: string, eventId: string, items: CreateOrderItemInput[]): Promise<InventoryResult> {
        const { data, error } = await supabase.rpc('decrement_inventory', {
            p_vendor_id: vendorId,
            p_event_id: eventId,
            p_items: items.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
        });

        if (error) throw new ValidationError(`Inventory check failed: ${error.message}`);

        if (data.status === 'out_of_stock') {
            throw new ValidationError(data.errors.join('; '));
        }

        return {
            lowStock: data.low_stock || [],
            soldOut: data.sold_out || [],
        };
    }

    async getAllOrders(params?: { vendorId?: string; eventId?: string; status?: string; startDate?: string; endDate?: string; pagination?: PaginationParams }): Promise<PaginatedResponse<Order>> {
        const page = Math.max(1, Number(params?.pagination?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(params?.pagination?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        let query = supabase.from("orders").select("*", { count: 'exact' });

        if (params?.vendorId) query = query.eq('vendor_id', params.vendorId);
        if (params?.eventId)  query = query.eq('event_id', params.eventId);
        if (params?.status)   query = query.eq('status', params.status);
        if (params?.startDate) query = query.gte('created_at', params.startDate);
        if (params?.endDate) query = query.lte('created_at', params.endDate);

        query = query.order('created_at', { ascending: false }).range(from, to);

        const { data, error, count } = await query;

        if (error) {
            throw new Error(`Failed to fetch orders: ${error.message}`);
        }

        const total = count || 0;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        return { orders: normalizeOrders(data || []), page, pageSize, total, totalPages };
    }

    async getOrderById(id: string): Promise<Order | null> {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq("id", id)
            .single()

        if (error) {
            throw new Error(`Failed to fetch order: ${error.message}`);
        }

        return data ? normalizeOrderItems(data) : null;
    }

    async createOrder(
        input: import('./order.types.js').CreateOrderInput & { customer_id?: string; customer_name?: string }
    ): Promise<Order & { paymentUrl: string }> {
        const qrHelper = new QRHelper();
        const isCashOrder = input.paymentMethod === 'CASH';

        // ── Step 1: Server-side price calculation + modifier validation ──
        const validated = await this.validateOrderItems(input.vendor_id, input.event_id, input.items);

        // ── Step 2: Atomic inventory decrement ──────────────────────────
        const inventoryResult = await this.decrementInventory(input.vendor_id, input.event_id, input.items);

        // ── Step 3: Apply discounts to server-calculated prices ─────────
        const discountService = new DiscountService();
        const discountInputs = validated.items.map((item: any) => ({
            itemId: item.id,
            price: item.basePrice ?? item.price,
        }));
        const discountMap = await discountService.resolveDiscountsForMenu(
            input.event_id,
            input.vendor_id,
            discountInputs
        );

        const validatedItems = validated.items.map((item: any) => {
            const basePrice = item.basePrice ?? item.price;
            const resolvedDiscount = discountMap.get(item.id);

            if (resolvedDiscount) {
                const modifierDelta = item.price - basePrice;
                const serverPrice = Math.max(0, Math.round((resolvedDiscount.discountedPrice + modifierDelta) * 100) / 100);
                return {
                    ...item,
                    price: serverPrice,
                    originalPrice: basePrice + modifierDelta,
                    discountId: resolvedDiscount.discountId,
                    discountSavings: resolvedDiscount.savings,
                };
            }
            return item;
        });

        let validatedTotal = validatedItems.reduce(
            (sum: number, item: any) => sum + (item.price * item.quantity), 0
        );

        // ── Step 4: Validate scheduled pickup time + slot capacity ────────
        if (input.scheduled_pickup_time) {
            const pickup = new Date(input.scheduled_pickup_time);
            const now = new Date();

            if (pickup.getTime() < now.getTime() + 10 * 60 * 1000) {
                throw new ValidationError('Pickup time must be at least 10 minutes in the future');
            }

            // Check slot capacity if configured
            const { data: menuConfig } = await supabase
                .from('event_menu_configurations')
                .select('max_orders_per_slot, slot_duration_minutes')
                .eq('vendor_id', input.vendor_id)
                .eq('event_id', input.event_id)
                .maybeSingle();

            if (menuConfig?.max_orders_per_slot) {
                const slotDuration = menuConfig.slot_duration_minutes || 15;
                const slotMs = slotDuration * 60 * 1000;
                const slotStart = new Date(Math.floor(pickup.getTime() / slotMs) * slotMs);
                const slotEnd = new Date(slotStart.getTime() + slotMs);

                const { count } = await supabase
                    .from('orders')
                    .select('id', { count: 'exact', head: true })
                    .eq('vendor_id', input.vendor_id)
                    .eq('event_id', input.event_id)
                    .in('status', ['PENDING', 'PREPARING', 'READY', 'PAYMENT_PENDING'])
                    .gte('scheduled_pickup_time', slotStart.toISOString())
                    .lt('scheduled_pickup_time', slotEnd.toISOString());

                if ((count || 0) >= menuConfig.max_orders_per_slot) {
                    throw new ValidationError('This pickup time slot is full. Please choose another time.');
                }
            }
        }

        // ── Step 5: Call the single-transaction RPC (1 Supabase call) ───
        // This replaces: vendor fetch, event fetch, menu config fetch+lock,
        // capacity increment, cooldown check, max orders check, dedup check,
        // idempotency check, customer name lookup, queue position calc, INSERT.
        const { data: rpcResult, error: rpcError } = await safeQuery(async () =>
            await supabase.rpc('create_order_validated', {
                p_vendor_id: input.vendor_id,
                p_event_id: input.event_id,
                p_phone: input.phone,
                p_items: validatedItems,
                p_total: Math.round(validatedTotal * 100) / 100,
                p_payment_method: isCashOrder ? 'CASH' : 'ONLINE',
                p_notes: input.notes || null,
                p_customer_id: input.customer_id || null,
                p_customer_name: input.customer_name || null,
                p_idempotency_key: input.idempotency_key,
                p_estimated_prep_time: null,
                p_queue_position: null,
                p_estimated_ready_time: null,
                p_scheduled_pickup_time: input.scheduled_pickup_time || null,
                p_service_fee: 0,
                p_age_verified: input.age_verified || false,
                p_qr_code: null,
            })
        );

        if (rpcError) {
            throw new Error(`Order creation failed: ${rpcError.message}`);
        }

        const result = rpcResult as any;

        // ── Step 4: Handle RPC result status ────────────────────────────
        // The RPC returns error codes instead of throwing, so we map them
        // to the appropriate JS error classes.
        if (result.status === 'idempotent_hit') {
            return { ...normalizeOrderItems(result.order), paymentUrl: '' } as Order & { paymentUrl: string };
        }

        const errorStatusMap: Record<string, () => never> = {
            vendor_not_found: () => { throw new NotFoundError(result.message); },
            event_not_found: () => { throw new NotFoundError(result.message); },
            event_not_started: () => { throw new ValidationError(result.message); },
            event_ended: () => { throw new ValidationError(result.message); },
            not_accepting: () => { throw new ValidationError(result.message); },
            paused: () => { throw new ValidationError(result.message); },
            closed: () => { throw new ValidationError(result.message); },
            at_capacity: () => { throw new ValidationError(result.message); },
            cooldown: () => { throw new TooManyRequestsError(result.message); },
            max_orders_reached: () => { throw new ValidationError(result.message); },
            cash_not_allowed: () => { throw new ValidationError(result.message); },
            customer_name_required: () => { throw new ValidationError(result.message); },
            duplicate: () => { throw new ConflictError(result.message); },
        };

        if (result.status !== 'ok' && errorStatusMap[result.status]) {
            errorStatusMap[result.status]();
        } else if (result.status !== 'ok') {
            throw new Error(`Order creation failed: ${result.message || result.status}`);
        }

        // ── Step 5: Post-RPC validations (JS-only, no DB) ───────────────
        const vendor = result.vendor;
        const menuConfig = result.menu_config;
        let createdOrder = result.order;
        const capacityIncremented = result.capacity_incremented;

        // Check minimum order value (vendor data came from RPC)
        if (vendor.minimum_order && validatedTotal < vendor.minimum_order) {
            await this.rollbackOrder(createdOrder.id, input.vendor_id, input.event_id, capacityIncremented);
            throw new ValidationError(
                `Minimum order value is R${vendor.minimum_order.toFixed(2)}. ` +
                `Your order total is R${validatedTotal.toFixed(2)}.`
            );
        }

        // Apply service fee (now that we have vendor.service_fee_percent)
        let serviceFee = 0;
        if (vendor.service_fee_percent) {
            serviceFee = Math.round(validatedTotal * (vendor.service_fee_percent / 100) * 100) / 100;
            validatedTotal = Math.round((validatedTotal + serviceFee) * 100) / 100;

            // Update the order with corrected total and service fee
            const { data: updated } = await supabase
                .from('orders')
                .update({ total: validatedTotal, service_fee: serviceFee })
                .eq('id', createdOrder.id)
                .select()
                .single();
            if (updated) createdOrder = updated;
        }

        // Check operating hours (JS logic on schedule data from RPC)
        if (menuConfig) {
            const checkTime = input.scheduled_pickup_time
                ? new Date(input.scheduled_pickup_time)
                : new Date();
            const pad = (n: number) => n.toString().padStart(2, '0');
            const checkHHMM = `${pad(checkTime.getUTCHours())}:${pad(checkTime.getUTCMinutes())}`;
            const checkDate = checkTime.toISOString().split('T')[0];

            const daySchedule = (menuConfig.operating_schedule as any[] | null)
                ?.find((s: any) => s.date === checkDate);

            if (daySchedule) {
                if (daySchedule.isClosed) {
                    await this.rollbackOrder(createdOrder.id, input.vendor_id, input.event_id, capacityIncremented);
                    throw new ValidationError(
                        input.scheduled_pickup_time
                            ? `This vendor is not operating on ${checkDate}.`
                            : 'This vendor is not operating today.'
                    );
                }
                if (daySchedule.openTime && daySchedule.closeTime && daySchedule.openTime !== daySchedule.closeTime) {
                    if (checkHHMM < daySchedule.openTime || checkHHMM >= daySchedule.closeTime) {
                        await this.rollbackOrder(createdOrder.id, input.vendor_id, input.event_id, capacityIncremented);
                        throw new ValidationError(
                            `This vendor operates ${daySchedule.openTime} – ${daySchedule.closeTime} on ${checkDate}.`
                        );
                    }
                }
            } else if (menuConfig.event_open_time && menuConfig.event_close_time && menuConfig.event_open_time !== menuConfig.event_close_time) {
                if (checkHHMM < menuConfig.event_open_time || checkHHMM >= menuConfig.event_close_time) {
                    await this.rollbackOrder(createdOrder.id, input.vendor_id, input.event_id, capacityIncremented);
                    throw new ValidationError(
                        `This vendor is only accepting orders between ${menuConfig.event_open_time} and ${menuConfig.event_close_time}.`
                    );
                }
            }
        }

        // ── Step 6: QR generation (background, non-blocking) ────────────
        let updatedOrder = createdOrder;
        try {
            const { qstash, getCallbackBaseUrl } = await import('../lib/qstash.js');
            const callbackUrl = getCallbackBaseUrl();
            if (qstash && callbackUrl) {
                void qstash.publishJSON({
                    url: `${callbackUrl}/internal/order-qr/generate`,
                    body: { orderId: createdOrder.id },
                }).catch(err => console.error('Failed to enqueue QR generation:', err?.message || err));
            } else {
                const { qr_code, qr_image } = await qrHelper.generateAndUploadQRCode(createdOrder.id);
                const { data: qrUpdated, error: updateError } = await supabase
                    .from('orders')
                    .update({ qr_code, qr_image })
                    .eq('id', createdOrder.id)
                    .select()
                    .single();
                if (updateError) {
                    throw new Error(`Failed to update order with QR code: ${updateError.message}`);
                }
                updatedOrder = qrUpdated;
            }
        } catch (qrErr: any) {
            console.error('QR generation error (non-fatal):', qrErr?.message || qrErr);
        }

        // Fire-and-forget: update queue positions
        this.scheduler.updateQueuePositions(input.vendor_id).catch(err =>
            console.error('Failed to update queue positions:', err?.message || err)
        );

        // Fire-and-forget: send push notifications for inventory alerts
        if (inventoryResult.soldOut.length > 0 || inventoryResult.lowStock.length > 0) {
            import('../push/push.service.js').then(({ pushService: push }) => {
                for (const item of inventoryResult.soldOut) {
                    push.sendToVendorUsers(input.vendor_id, {
                        title: `Sold out: ${item.name}`,
                        body: 'Stock depleted',
                        tag: `sold-out-${item.id}`,
                        data: { url: '/menu', type: 'sold_out' },
                    }).catch(() => {});
                    // Broadcast availability update via WebSocket
                    broadcastToVendor(input.vendor_id, { type: 'ITEM_AVAILABILITY_UPDATE', payload: { vendorId: input.vendor_id, eventId: input.event_id, itemId: item.id, status: 'OUT_OF_STOCK' }, timestamp: new Date().toISOString() });
                }
                for (const item of inventoryResult.lowStock) {
                    push.sendToVendorUsers(input.vendor_id, {
                        title: `Low stock: ${item.name}`,
                        body: `${item.remaining} remaining`,
                        tag: `low-stock-${item.id}`,
                        data: { url: '/menu', type: 'low_stock' },
                    }).catch(() => {});
                }
            }).catch(() => {});
        }

        // ── Step 7: Cash orders — done, send notifications ──────────────
        if (isCashOrder) {
            this.sendOrderNotifications(updatedOrder).catch(err =>
                console.error('Failed to send cash order notifications:', err?.message || err)
            );
            return { ...normalizeOrderItems(updatedOrder), paymentUrl: '' };
        }

        // ── Step 8: Online payment (1 Stitch HTTP call + 1 DB update) ───
        const payerName = result.customer_name || input.customer_name || 'Customer';
        let paymentId: string;
        let paymentUrl: string;
        try {
            const payment = await paymentService.createPaymentRequest(
                updatedOrder.id,
                validatedTotal,  // REST v2 uses rands, not cents
                payerName,
                input.phone
            );
            paymentId = payment.paymentId;
            paymentUrl = payment.paymentUrl;
        } catch (paymentErr) {
            // Payment failed — cancel order and rollback counter
            await this.rollbackOrder(createdOrder.id, input.vendor_id, input.event_id, capacityIncremented);
            // Restore inventory since order is being rolled back
            void supabase.rpc('restore_inventory', { p_order_id: createdOrder.id });
            throw paymentErr;
        }

        await supabase
            .from('orders')
            .update({ stitch_payment_id: paymentId })
            .eq('id', updatedOrder.id);

        return { ...normalizeOrderItems(updatedOrder), paymentUrl };
    }

    /** Cancel an order, decrement active orders counter, and restore inventory (used on post-insert failures). */
    private async rollbackOrder(orderId: string, vendorId: string, eventId: string, decrementCounter: boolean): Promise<void> {
        const { error: cancelErr } = await supabase
            .from('orders')
            .update({ status: OrderStatus.CANCELLED, payment_status: 'failed' })
            .eq('id', orderId);
        if (cancelErr) console.error('Failed to cancel order during rollback:', cancelErr.message);

        if (decrementCounter && eventId) {
            const { error: decErr } = await supabase.rpc('decrement_active_orders', {
                p_vendor_id: vendorId,
                p_event_id: eventId,
            });
            if (decErr) console.error('Failed to decrement active orders during rollback:', decErr.message);
        }

        // Restore inventory
        supabase.rpc('restore_inventory', { p_order_id: orderId }).then(({ error: restoreErr }) => {
            if (restoreErr) console.error('Failed to restore inventory during rollback:', restoreErr.message);
        });
    }

    /**
     * Send WhatsApp + WebSocket notifications for a confirmed order.
     * Called from webhook handler after payment is confirmed.
     */
    async sendOrderNotifications(order: any): Promise<void> {
        try {
            // Fire-and-forget WhatsApp notification
            const token = process.env.WA_ACCESS_TOKEN;
            if (token && token !== 'disabled' && process.env.NODE_ENV !== 'test' && order?.phone) {
                const whatsapp = getWhatsappService();

                void whatsapp
                    .sendOrderPlacedTemplate(order.phone, {
                        orderId: String(order.id),
                        total: String(order.total),
                        prepTimeMinutes: String(order.estimated_prep_time || 12),
                        qrImageUrl: order.qr_image || '',
                    })
                    .catch((err) => {
                        console.error('Failed to send WhatsApp notification:', err?.message || err);
                    });
            }

            // Notify the vendor's live panel in real time
            broadcastNewOrder({
                orderId: order.id,
                vendorId: order.vendor_id,
                eventId: order.event_id,
                phone: order.phone,
            });

            // Notify admin dashboard live feed
            broadcastAdminOrderFeed({
                orderId: order.id,
                customerPhone: order.phone || null,
                customerName: order.customer_name || null,
                vendorId: order.vendor_id,
                vendorName: null,
                eventId: order.event_id || null,
                eventName: null,
                total: Number(order.total) || 0,
                status: order.status,
                paymentStatus: order.payment_status || null,
                items: Array.isArray(order.items)
                    ? order.items.map((i: any) => ({ name: i.name || i.menu_item_name || '', quantity: i.quantity || 1 }))
                    : [],
                createdAt: order.created_at,
            });
        } catch (err) {
            console.error('Failed to send order notifications:', err);
        }
    }

    /**
     * Confirms order collection by scanning QR code
     * Updates status to COLLECTED and sends confirmation WhatsApp
     */
    async confirmCollectionByQR(qrCode: string, vendorId: string): Promise<Order> {
        const qrHelper = new QRHelper();
        const result = qrHelper.verifyQRSignature(qrCode);

        if (!result.valid || !result.orderId) {
            throw new ValidationError('Invalid or unrecognised QR code');
        }

        const orderId = result.orderId;

        // Fetch order by ID (without vendor filter) for distinct error messages
        const { data: order, error: fetchError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (fetchError || !order) {
            throw new NotFoundError('Order not found');
        }

        // Check vendor ownership
        if (order.vendor_id !== vendorId) {
            throw new ForbiddenError('This order does not belong to your vendor');
        }

        // Validate order status
        if (order.status !== OrderStatus.READY) {
            const statusMessages: Record<string, string> = {
                [OrderStatus.COLLECTED]: 'This order has already been collected',
                [OrderStatus.CANCELLED]: 'This order was cancelled',
                [OrderStatus.PENDING]: 'This order hasn\'t been prepared yet',
                [OrderStatus.PREPARING]: 'This order is still being prepared',
                [OrderStatus.PAYMENT_PENDING]: 'Payment hasn\'t been confirmed for this order',
            };
            throw new ValidationError(statusMessages[order.status] || `Order cannot be collected (status: ${order.status})`);
        }

        // Update order status to COLLECTED
        const { data: updatedOrder, error: updateError } = await supabase
            .from('orders')
            .update({
                status: OrderStatus.COLLECTED,
                collected_at: new Date().toISOString(),
            })
            .eq('id', orderId)
            .select()
            .single();

        if (updateError) {
            throw new Error(`Failed to update order: ${updateError.message}`);
        }

        // Decrement active orders counter on collection
        if (order.event_id) {
            void (async () => {
                const { error: decErr } = await supabase.rpc('decrement_active_orders', {
                    p_vendor_id: order.vendor_id,
                    p_event_id: order.event_id,
                });
                if (decErr) console.error('Failed to decrement active orders on collection:', decErr.message);
            })();
        }

        // Send collection confirmation via WhatsApp (fire-and-forget, non-blocking)
        try {
            const token = process.env.WA_ACCESS_TOKEN;
            if (token && token !== 'disabled' && process.env.NODE_ENV !== 'test' && order.phone) {
                // Fetch vendor name inside fire-and-forget to avoid blocking the response
                void (async () => {
                    try {
                        const { data: vendor } = await supabase
                            .from('vendors')
                            .select('name')
                            .eq('id', order.vendor_id)
                            .single();

                        const whatsapp = getWhatsappService();
                        await whatsapp.sendOrderCollectedTemplate(order.phone, {
                            orderId: String(orderId),
                            vendorName: vendor?.name || 'the vendor',
                        });
                    } catch (err: any) {
                        console.error('Failed to send collection confirmation:', err?.message || err);
                    }
                })();
            }
        } catch (notifyErr) {
            console.error('WhatsApp notification error (non-fatal):', (notifyErr as any)?.message || notifyErr);
        }

        // Schedule retention nudges (fire-and-forget, non-fatal)
        try {
            if (order.customer_id && order.phone && process.env.NODE_ENV !== 'test') {
                const { NudgeScheduler } = await import('../retention/nudge.scheduler.js');
                const { data: event } = await supabase
                    .from('events')
                    .select('id, name, code, end_date, event_type')
                    .eq('id', order.event_id)
                    .single();

                if (event) {
                    const scheduler = new NudgeScheduler();
                    void scheduler
                        .scheduleRetentionNudges(order, event)
                        .catch((err: any) => {
                            console.error('Retention scheduling error (non-fatal):', err?.message || err);
                        });
                }
            }
        } catch (retentionErr) {
            console.error('Retention import error (non-fatal):', (retentionErr as any)?.message || retentionErr);
        }

        return normalizeOrderItems(updatedOrder);
    }


    async updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
        // Fetch current order first
        const { data: currentOrder, error: fetchError } = await supabase
            .from('orders')
            .select()
            .eq('id', id)
            .single();

        if (fetchError) {
            throw new Error(`Failed to fetch order: ${fetchError.message}`);
        }

        // Cancellation is only allowed from PENDING or PREPARING status
        if (status === OrderStatus.CANCELLED && currentOrder.status !== OrderStatus.PENDING && currentOrder.status !== OrderStatus.PREPARING) {
            throw new ValidationError('Order can only be cancelled before it is ready', {
                currentStatus: currentOrder.status,
            });
        }

        const updateData: Partial<Order> = { status };

        // Only set type to CART if the order was PENDING
        if (currentOrder.status === OrderStatus.PENDING && status === OrderStatus.PREPARING) {
            updateData.type = OrderType.CART;
        }

        // Add timestamp based on status
        if (status === OrderStatus.PREPARING) {
            updateData.prepared_at = new Date().toISOString();
        } else if (status === OrderStatus.READY) {
            updateData.ready_at = new Date().toISOString();

            // Calculate actual prep time if prepared_at exists
            if (currentOrder.prepared_at) {
                const actualPrepTime = this.scheduler.calculateActualPrepTime(
                    currentOrder.prepared_at,
                    updateData.ready_at
                );
                updateData.actual_prep_time = actualPrepTime;
            }
        } else if (status === OrderStatus.COLLECTED) {
            updateData.collected_at = new Date().toISOString();
        }

        const { data, error } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to update order status: ${error.message}`);
        }

        // Restore inventory on cancellation (before PREPARING = full restore)
        if (status === OrderStatus.CANCELLED) {
            void supabase.rpc('restore_inventory', { p_order_id: id }).then(({ error: restErr }) => {
                if (restErr) console.error('Failed to restore inventory on cancellation:', restErr.message);
            });
        }

        // Decrement active orders counter when order leaves the active pipeline
        if (
            (status === OrderStatus.COLLECTED || status === OrderStatus.CANCELLED) &&
            currentOrder.event_id
        ) {
            void (async () => {
                const { error: decErr } = await supabase.rpc('decrement_active_orders', {
                    p_vendor_id: currentOrder.vendor_id,
                    p_event_id: currentOrder.event_id,
                });
                if (decErr) console.error('Failed to decrement active orders:', decErr.message);
            })();
        }

        // Fire-and-forget: update queue positions when order completes
        if (status === OrderStatus.COLLECTED || status === OrderStatus.READY) {
            this.scheduler.updateQueuePositions(currentOrder.vendor_id).catch(err =>
                console.error('Failed to update queue positions:', err?.message || err)
            );
        }

        if (status === OrderStatus.READY) {
            try {
                const token = process.env.WA_ACCESS_TOKEN;
                if (token && token !== 'disabled' && process.env.NODE_ENV !== 'test' && data.phone) {
                    // Fetch vendor name for the message
                    const { data: vendor } = await supabase
                        .from('vendors')
                        .select('name')
                        .eq('id', data.vendor_id)
                        .single();

                    const whatsapp = getWhatsappService();

                    void whatsapp
                        .sendOrderReadyTemplate(data.phone, {
                            orderId: String(data.id),
                            vendorName: vendor?.name || 'the vendor',
                        })
                        .catch((err) => {
                            console.error('Failed to send order ready notification:', err?.message || err);
                        });
                }
            } catch (notifyErr) {
                console.error('WhatsApp notification error (non-fatal):', (notifyErr as any)?.message || notifyErr);
            }
        }

        // Broadcast to customer tracking their order
        if (data.phone) {
            broadcastOrderStatusUpdate({
                orderId: data.id,
                phone: data.phone,
                status: data.status,
                vendorId: data.vendor_id,
                eventId: data.event_id,
            });
        }

        // Broadcast status change to admin live feed
        broadcastToAdmins({
            type: 'ORDER_STATUS_UPDATE',
            payload: { orderId: data.id, status: data.status },
            timestamp: new Date().toISOString(),
        });

        // Broadcast to vendor's KDS and live event panel
        broadcastToVendor(data.vendor_id, {
            type: 'ORDER_STATUS_UPDATE',
            payload: {
                orderId: data.id,
                phone: data.phone,
                status: data.status,
                vendorId: data.vendor_id,
                eventId: data.event_id,
            },
            timestamp: new Date().toISOString(),
        });

        // Fire-and-forget: Web Push notifications for status changes
        import('../push/push.service.js').then(({ pushService: push }) => {
            const orderRef = data.id.slice(-4).toUpperCase();
            if (status === OrderStatus.PREPARING && data.phone) {
                push.sendToUser('customer', data.phone, {
                    title: 'Being prepared',
                    body: `#${orderRef} is being made`,
                    tag: `order-preparing-${data.id}`,
                    data: { url: '/orders', type: 'order_preparing', orderId: data.id },
                }).catch(() => {});
            } else if (status === OrderStatus.READY && data.phone) {
                push.sendToUser('customer', data.phone, {
                    title: 'Order ready!',
                    body: `#${orderRef} is ready for collection`,
                    tag: `order-ready-${data.id}`,
                    data: { url: '/orders', type: 'order_ready', orderId: data.id },
                }).catch(() => {});
            }
        }).catch(() => {});

        return normalizeOrderItems(data);
    }

    async getOrdersByVendor(vendorId: string, pagination?: PaginationParams): Promise<PaginatedResponse<Order>> {
        const page = Math.max(1, Number(pagination?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(pagination?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        const { data, error, count } = await safeQuery(() => Promise.resolve(
            supabase
                .from('orders')
                .select('*', { count: 'exact' })
                .eq('vendor_id', vendorId)
                .order('created_at', { ascending: false })
                .range(from, to)
        )) as any;

        if (error) {
            throw new Error(`Failed to fetch vendor orders: ${error.message}`);
        }

        const total = count || 0;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        return { orders: normalizeOrders(data || []), page, pageSize, total, totalPages };
    }

    async getOrdersByPhone(phone: string, pagination?: PaginationParams, eventId?: string): Promise<PaginatedResponse<Order>> {
        const page = Math.max(1, Number(pagination?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(pagination?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        let query = supabase
            .from('orders')
            .select('*', { count: 'exact' })
            .eq('phone', phone);

        if (eventId) query = query.eq('event_id', eventId);

        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            throw new Error(`Failed to fetch orders by phone: ${error.message}`);
        }

        const orders: Order[] = data || [];

        // Enrich orders with vendor name + stall info
        if (orders.length > 0) {
            const vendorIds = [...new Set(orders.map(o => o.vendor_id))];
            const eventIds = [...new Set(orders.map(o => o.event_id).filter(Boolean))];

            const [vendorResult, configResult] = await Promise.all([
                supabase
                    .from('vendors')
                    .select('id, name')
                    .in('id', vendorIds),
                eventIds.length > 0
                    ? supabase
                        .from('event_menu_configurations')
                        .select('vendor_id, event_id, booth_info')
                        .in('vendor_id', vendorIds)
                        .in('event_id', eventIds)
                    : Promise.resolve({ data: [] }),
            ]);

            const vendorMap = new Map<string, string>();
            (vendorResult.data || []).forEach((v: any) => vendorMap.set(v.id, v.name));

            const stallMap = new Map<string, string>();
            (configResult.data || []).forEach((c: any) => {
                if (c.booth_info) stallMap.set(`${c.vendor_id}:${c.event_id}`, c.booth_info);
            });

            for (const order of orders) {
                const vendorName = vendorMap.get(order.vendor_id);
                if (vendorName) order.vendor = { name: vendorName };
                const stallInfo = stallMap.get(`${order.vendor_id}:${order.event_id}`);
                if (stallInfo) order.stall_info = stallInfo;
            }
        }

        const total = count || 0;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        return { orders: normalizeOrders(orders), page, pageSize, total, totalPages };
    }

    async getOrdersByCustomerId(customerId: string, pagination?: PaginationParams, eventId?: string): Promise<PaginatedResponse<Order>> {
        const page = Math.max(1, Number(pagination?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(pagination?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        let query = supabase
            .from('orders')
            .select('*', { count: 'exact' })
            .eq('customer_id', customerId);

        if (eventId) query = query.eq('event_id', eventId);

        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            throw new Error(`Failed to fetch orders by customer: ${error.message}`);
        }

        const orders: Order[] = data || [];

        // Enrich orders with vendor name + stall info
        if (orders.length > 0) {
            const vendorIds = [...new Set(orders.map(o => o.vendor_id))];
            const eventIds = [...new Set(orders.map(o => o.event_id).filter(Boolean))];

            const [vendorResult, configResult] = await Promise.all([
                supabase
                    .from('vendors')
                    .select('id, name')
                    .in('id', vendorIds),
                eventIds.length > 0
                    ? supabase
                        .from('event_menu_configurations')
                        .select('vendor_id, event_id, booth_info')
                        .in('vendor_id', vendorIds)
                        .in('event_id', eventIds)
                    : Promise.resolve({ data: [] }),
            ]);

            const vendorMap = new Map<string, string>();
            (vendorResult.data || []).forEach((v: any) => vendorMap.set(v.id, v.name));

            const stallMap = new Map<string, string>();
            (configResult.data || []).forEach((c: any) => {
                if (c.booth_info) stallMap.set(`${c.vendor_id}:${c.event_id}`, c.booth_info);
            });

            for (const order of orders) {
                const vendorName = vendorMap.get(order.vendor_id);
                if (vendorName) order.vendor = { name: vendorName };
                const stallInfo = stallMap.get(`${order.vendor_id}:${order.event_id}`);
                if (stallInfo) order.stall_info = stallInfo;
            }
        }

        const total = count || 0;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        return { orders: normalizeOrders(orders), page, pageSize, total, totalPages };
    }

    async getOrdersByStatus(status: string, pagination?: PaginationParams): Promise<PaginatedResponse<Order>> {
        const page = Math.max(1, Number(pagination?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(pagination?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        const { data, error, count } = await supabase
            .from('orders')
            .select('*', { count: 'exact' })
            .eq('status', status)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            throw new Error(`Failed to fetch orders by status: ${error.message}`);
        }

        const total = count || 0;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        return { orders: normalizeOrders(data || []), page, pageSize, total, totalPages };
    }

    async getRecentOrders(limit: number = 10): Promise<Order[]> {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit)

        if (error) {
            throw new Error(`Failed to fetch recent orders: ${error.message}`);
        }

        return normalizeOrders(data || []);
    }

    async deleteOrder(id: string): Promise<void> {
        const { error } = await supabase
            .from('orders')
            .delete()
            .eq('id', id)

        if (error) {
            throw new Error(`Failed to delete order: ${error.message}`);
        }
    }

    async getOrdersByDateRange(startDate: string, endDate: string, pagination?: PaginationParams): Promise<PaginatedResponse<Order>> {
        const page = Math.max(1, Number(pagination?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(pagination?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        const { data, error, count } = await supabase
            .from('orders')
            .select('*', { count: 'exact' })
            .gte('created_at', startDate)
            .lte('created_at', `${endDate}T23:59:59.999Z`)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            throw new Error(`Failed to fetch orders by date range: ${error.message}`);
        }

        const total = count || 0;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        return { orders: normalizeOrders(data || []), page, pageSize, total, totalPages };
    }

    async refundOrder(orderId: string, dto: RefundOrderDto): Promise<Order> {
        const { data: order, error: fetchError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (fetchError || !order) {
            throw new NotFoundError('Order not found');
        }

        if (order.payment_status !== 'complete' && order.payment_status !== 'pay_at_stall') {
            throw new ValidationError('Only paid orders can be refunded', {
                payment_status: order.payment_status,
            });
        }

        if (order.refund_status && order.refund_status !== 'none') {
            throw new ValidationError('Order has already been refunded');
        }

        let refundAmount: number;
        if (dto.type === 'full') {
            refundAmount = Number(order.total);
        } else {
            if (!dto.amount || dto.amount <= 0) {
                throw new ValidationError('Partial refund requires a positive amount');
            }
            if (dto.amount > Number(order.total)) {
                throw new ValidationError('Refund amount cannot exceed order total', {
                    amount: dto.amount,
                    orderTotal: order.total,
                });
            }
            refundAmount = dto.amount;
        }

        const { data: updated, error: updateError } = await supabase
            .from('orders')
            .update({
                refund_status: dto.type,
                refund_amount: refundAmount,
                refund_reason: dto.reason,
                refunded_at: new Date().toISOString(),
                refunded_by: dto.refundedBy,
            })
            .eq('id', orderId)
            .select()
            .single();

        if (updateError) {
            throw new Error(`Failed to refund order: ${updateError.message}`);
        }

        // Invalidate cached stats with explicit keys (Upstash doesn't support glob DELETE)
        const statsKeys = [
            `order:stats:${order.vendor_id}:all`,
            `order:stats:${order.vendor_id}:${order.event_id || 'all'}`,
            `order:stats:all:all`,
            `order:stats:all:${order.event_id || 'all'}`,
            `order:timeseries:${order.vendor_id}:all`,
            `order:timeseries:all:all`,
        ];
        await Promise.all(statsKeys.map(k => cache.del(k).catch(() => {})));

        // Send refund confirmation email to customer
        if (order.customer_id) {
            const { data: customer } = await supabase.from('customers').select('email, name').eq('id', order.customer_id).single();
            if (customer?.email) {
                void sendEmail({
                    to: customer.email,
                    subject: `Refund ${dto.type === 'full' ? 'Processed' : 'Partially Processed'} — Order #${orderId.slice(0, 8)}`,
                    html: `
                        <h2>Refund Confirmation</h2>
                        <p>Hi ${customer.name || 'there'},</p>
                        <p>Your ${dto.type} refund of <strong>R${refundAmount.toFixed(2)}</strong> has been processed for order #${orderId.slice(0, 8)}.</p>
                        ${dto.reason ? `<p><strong>Reason:</strong> ${dto.reason}</p>` : ''}
                        <p>Please allow 3-5 business days for the refund to reflect in your account.</p>
                        <p style="color:#666;font-size:12px;">If you have questions, contact our support team.</p>
                    `,
                }).catch(err => console.error('Failed to send refund email:', err?.message || err));
            }
        }

        return updated;
    }

    async getOrderStats(vendorId?: string, eventId?: string): Promise<OrderStats> {
        const cacheKey = `order:stats:${vendorId || 'all'}:${eventId || 'all'}`;
        const cached = await cache.get<OrderStats>(cacheKey);
        if (cached) return cached;

        // Parallel queries: summary stats (no items) + items for top-item calc
        let summaryQuery = supabase.from('orders').select('total, status, payment_method, refund_status, refund_amount, created_at, collected_at, phone');
        let itemsQuery = supabase.from('orders').select('items, status').neq('status', OrderStatus.CANCELLED);

        if (vendorId) {
            summaryQuery = summaryQuery.eq('vendor_id', vendorId);
            itemsQuery = itemsQuery.eq('vendor_id', vendorId);
        }
        if (eventId) {
            summaryQuery = summaryQuery.eq('event_id', eventId);
            itemsQuery = itemsQuery.eq('event_id', eventId);
        }

        const [summaryResult, itemsResult] = await Promise.all([summaryQuery, itemsQuery]);

        if (summaryResult.error) {
            throw new Error(`Failed to fetch order stats: ${summaryResult.error.message}`);
        }

        const orders = (summaryResult.data || []) as any[];
        const nonCancelledWithItems = (itemsResult.data || []) as any[];

        const nonCancelled = orders.filter((o: any) => o.status !== OrderStatus.CANCELLED);
        const cancelled = orders.filter((o: any) => o.status === OrderStatus.CANCELLED);
        const collected = orders.filter((o: any) => o.status === OrderStatus.COLLECTED);

        const totalRevenue = orders.reduce((sum: number, o: any) => sum + Number(o.total), 0);
        const grossSales = nonCancelled.reduce((sum: number, o: any) => sum + Number(o.total), 0);
        const collectedRevenue = collected.reduce((sum: number, o: any) => sum + Number(o.total), 0);
        const cancelledValue = cancelled.reduce((sum: number, o: any) => sum + Number(o.total), 0);

        // Top item by quantity across non-cancelled orders
        const itemCounts: Record<string, number> = {};
        nonCancelledWithItems.forEach((o: any) => {
            const items = Array.isArray(o.items) ? o.items : [];
            items.forEach((i: any) => {
                const name = i.name || 'Unknown';
                itemCounts[name] = (itemCounts[name] || 0) + (Number(i.quantity) || 1);
            });
        });
        const topEntry = Object.entries(itemCounts).sort((a, b) => b[1] - a[1])[0];

        const topItems = Object.entries(itemCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, qty]) => ({ name, qty }));

        // Payment method breakdown (non-cancelled)
        const paymentBreakdown: Record<string, number> = {};
        nonCancelled.forEach((o: any) => {
            const method = o.payment_method ?? 'Unknown';
            paymentBreakdown[method] = (paymentBreakdown[method] || 0) + Number(o.total);
        });

        const refunded = orders.filter((o: any) => o.refund_status && o.refund_status !== 'none');
        const refundedValue = refunded.reduce((sum: number, o: any) => sum + Number(o.refund_amount || 0), 0);

        // Avg turnaround: created_at → collected_at for collected orders (in minutes)
        const fulfilledOrders = collected.filter((o: any) => o.created_at && o.collected_at);
        const avgTurnaroundMinutes = fulfilledOrders.length > 0
            ? fulfilledOrders.reduce((sum: number, o: any) => {
                const created = new Date(o.created_at).getTime();
                const collectedAt = new Date(o.collected_at).getTime();
                return sum + (collectedAt - created) / 60000;
            }, 0) / fulfilledOrders.length
            : null;

        // Peak order hours: count orders per hour of day
        const hourCounts: Record<number, number> = {};
        orders.forEach((o: any) => {
            if (o.created_at) {
                const hour = new Date(o.created_at).getHours();
                hourCounts[hour] = (hourCounts[hour] || 0) + 1;
            }
        });
        const peakHours = Object.entries(hourCounts)
            .sort((a, b) => Number(b[1]) - Number(a[1]))
            .slice(0, 3)
            .map(([hour, count]) => ({ hour: Number(hour), count }));

        // Avg items per order (non-cancelled)
        const totalItemQty = nonCancelledWithItems.reduce((sum: number, o: any) => {
            const items = Array.isArray(o.items) ? o.items : [];
            return sum + items.reduce((s: number, i: any) => s + (Number(i.quantity) || 1), 0);
        }, 0);
        const avgItemsPerOrder = nonCancelled.length > 0
            ? Math.round((totalItemQty / nonCancelled.length) * 10) / 10
            : null;

        // Repeat customers: distinct phones with >1 non-cancelled order
        const phoneCounts: Record<string, number> = {};
        nonCancelled.forEach((o: any) => {
            if (o.phone) phoneCounts[o.phone] = (phoneCounts[o.phone] || 0) + 1;
        });
        const repeatCustomerCount = Object.values(phoneCounts).filter(c => c > 1).length;

        const stats: OrderStats = {
            totalOrders: orders.length,
            totalRevenue,
            averageOrderValue: orders.length > 0 ? totalRevenue / orders.length : 0,
            ordersByStatus: orders.reduce((acc: Record<string, number>, o: any) => {
                acc[o.status] = (acc[o.status] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
            grossSales,
            collectedRevenue,
            cancelledCount: cancelled.length,
            cancelledValue,
            topItem: topEntry ? { name: topEntry[0], qty: topEntry[1] } : null,
            paymentBreakdown,
            topItems,
            refundedCount: refunded.length,
            refundedValue,
            avgTurnaroundMinutes: avgTurnaroundMinutes !== null ? Math.round(avgTurnaroundMinutes) : null,
            peakHours,
            avgItemsPerOrder,
            repeatCustomerCount,
        };

        await cache.set(cacheKey, stats, CACHE_TTL.ITEM_AVAILABILITY); // 10s TTL
        return stats;
    }

    async getTimeSeriesStats(params: {
        vendorId?: string; eventId?: string;
        startDate: string; endDate: string;
        granularity: TimeSeriesGranularity;
    }): Promise<TimeSeriesStats> {
        const { vendorId, eventId, startDate, endDate, granularity } = params;
        const cacheKey = `order:timeseries:${vendorId || 'all'}:${eventId || 'all'}:${startDate}:${endDate}:${granularity}`;
        const cached = await cache.get<TimeSeriesStats>(cacheKey);
        if (cached) return cached;

        // Build primary period query
        let primaryQuery = supabase.from('orders')
            .select('total, status, payment_method, items, created_at, collected_at, refund_status, refund_amount');
        if (vendorId) primaryQuery = primaryQuery.eq('vendor_id', vendorId);
        if (eventId) primaryQuery = primaryQuery.eq('event_id', eventId);
        primaryQuery = primaryQuery.gte('created_at', startDate).lte('created_at', `${endDate}T23:59:59.999Z`);

        // Compute previous period range (same duration before startDate)
        const startMs = new Date(startDate).getTime();
        const endMs = new Date(endDate).getTime();
        const duration = endMs - startMs;
        const prevStart = new Date(startMs - duration).toISOString();
        const prevEnd = new Date(startMs - 1).toISOString();

        // Build previous period query
        let prevQuery = supabase.from('orders')
            .select('total, status');
        if (vendorId) prevQuery = prevQuery.eq('vendor_id', vendorId);
        if (eventId) prevQuery = prevQuery.eq('event_id', eventId);
        prevQuery = prevQuery.gte('created_at', prevStart).lte('created_at', prevEnd);

        const [primaryResult, prevResult] = await Promise.all([primaryQuery, prevQuery]);

        if (primaryResult.error) {
            throw new Error(`Failed to fetch time series stats: ${primaryResult.error.message}`);
        }

        const orders = (primaryResult.data || []) as any[];
        const prevOrders = (prevResult.data || []) as any[];

        // Bucket primary orders by granularity
        const bucketMap = new Map<string, { revenue: number; orderCount: number; collectedRevenue: number; cancelledCount: number; refundedCount: number }>();

        for (const order of orders) {
            const date = new Date(order.created_at);
            let key: string;
            if (granularity === 'day') {
                key = date.toISOString().split('T')[0]; // YYYY-MM-DD
            } else if (granularity === 'week') {
                // ISO week Monday
                const d = new Date(date);
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                d.setDate(diff);
                key = d.toISOString().split('T')[0];
            } else {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            }

            if (!bucketMap.has(key)) {
                bucketMap.set(key, { revenue: 0, orderCount: 0, collectedRevenue: 0, cancelledCount: 0, refundedCount: 0 });
            }
            const bucket = bucketMap.get(key)!;
            bucket.orderCount++;
            if (order.status !== OrderStatus.CANCELLED) {
                bucket.revenue += Number(order.total);
            }
            if (order.status === OrderStatus.COLLECTED) {
                bucket.collectedRevenue += Number(order.total);
            }
            if (order.status === OrderStatus.CANCELLED) {
                bucket.cancelledCount++;
            }
            if (order.refund_status && order.refund_status !== 'none') {
                bucket.refundedCount++;
            }
        }

        const buckets: TimeSeriesBucket[] = Array.from(bucketMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, data]) => ({ date, ...data }));

        // Build summary from primary-period orders
        const nonCancelled = orders.filter((o: any) => o.status !== OrderStatus.CANCELLED);
        const cancelled = orders.filter((o: any) => o.status === OrderStatus.CANCELLED);
        const collected = orders.filter((o: any) => o.status === OrderStatus.COLLECTED);

        const grossSales = nonCancelled.reduce((sum: number, o: any) => sum + Number(o.total), 0);
        const collectedRevenue = collected.reduce((sum: number, o: any) => sum + Number(o.total), 0);
        const cancelledValue = cancelled.reduce((sum: number, o: any) => sum + Number(o.total), 0);

        const paymentBreakdown: Record<string, number> = {};
        nonCancelled.forEach((o: any) => {
            const method = o.payment_method ?? 'Unknown';
            paymentBreakdown[method] = (paymentBreakdown[method] || 0) + Number(o.total);
        });

        const ordersByStatus: Record<string, number> = {};
        orders.forEach((o: any) => {
            ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1;
        });

        // Top items from non-cancelled orders
        const itemCounts: Record<string, number> = {};
        nonCancelled.forEach((o: any) => {
            const items = Array.isArray(o.items) ? o.items : [];
            items.forEach((i: any) => {
                const name = i.name || 'Unknown';
                itemCounts[name] = (itemCounts[name] || 0) + (Number(i.quantity) || 1);
            });
        });
        const topItems = Object.entries(itemCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, qty]) => ({ name, qty }));

        const tsRefunded = orders.filter((o: any) => o.refund_status && o.refund_status !== 'none');
        const tsRefundedValue = tsRefunded.reduce((sum: number, o: any) => sum + Number(o.refund_amount || 0), 0);

        const summary: TimeSeriesSummary = {
            grossSales,
            collectedRevenue,
            totalOrders: orders.length,
            averageOrderValue: orders.length > 0 ? grossSales / nonCancelled.length || 0 : 0,
            cancelledCount: cancelled.length,
            cancelledValue,
            paymentBreakdown,
            ordersByStatus,
            topItems,
            refundedCount: tsRefunded.length,
            refundedValue: tsRefundedValue,
        };

        // Build previous period summary
        const prevNonCancelled = prevOrders.filter((o: any) => o.status !== OrderStatus.CANCELLED);
        const prevCollected = prevOrders.filter((o: any) => o.status === OrderStatus.COLLECTED);
        const prevGrossSales = prevNonCancelled.reduce((sum: number, o: any) => sum + Number(o.total), 0);
        const prevCollectedRevenue = prevCollected.reduce((sum: number, o: any) => sum + Number(o.total), 0);

        const previousPeriod: PreviousPeriodSummary = {
            grossSales: prevGrossSales,
            collectedRevenue: prevCollectedRevenue,
            totalOrders: prevOrders.length,
            averageOrderValue: prevNonCancelled.length > 0 ? prevGrossSales / prevNonCancelled.length : 0,
        };

        const result: TimeSeriesStats = { buckets, summary, previousPeriod };
        await cache.set(cacheKey, result, CACHE_TTL.ITEM_AVAILABILITY);
        return result;
    }

    async getOrdersByEvent(eventId: string, pagination?: PaginationParams): Promise<PaginatedResponse<Order>> {
        const page = Math.max(1, Number(pagination?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(pagination?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        const { data, error, count } = await supabase
            .from('orders')
            .select('*', { count: 'exact' })
            .eq('event_id', eventId)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            throw new Error(`Failed to fetch event orders: ${error.message}`);
        }

        const total = count || 0;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        return { orders: normalizeOrders(data || []), page, pageSize, total, totalPages };
    }

    async searchOrders(searchTerm: string, eventId?: string, pagination?: PaginationParams): Promise<PaginatedResponse<Order>> {
        const page = Math.max(1, Number(pagination?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(pagination?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        // Sanitize PostgREST filter metacharacters in user input
        const sanitized = searchTerm.replace(/%/g, '\\%').replace(/_/g, '\\_');

        let query = supabase
            .from('orders')
            .select('*', { count: 'exact' });

        if (eventId) {
            query = query.eq('event_id', eventId);
        }

        const { data, error, count } = await query
            .or(`phone.ilike.%${sanitized}%,qr_code.ilike.%${sanitized}%,id.ilike.%${sanitized}%`)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            throw new Error(`Failed to search orders: ${error.message}`);
        }

        const total = count || 0;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        return { orders: normalizeOrders(data || []), page, pageSize, total, totalPages };
    }

    async health(): Promise<void> {
        const { error } = await supabase.from("orders").select("count");

        if (error) {
            throw new Error(`Failed to find order: ${error.message}`);
        }
    }

    /**
     * Cancel orders stuck in PAYMENT_PENDING for more than `maxAgeMinutes`.
     * Should be called periodically (e.g., every 5 minutes via cron/QStash).
     * Also decrements the active orders counter for each expired order.
     */
    async cleanupStalePaymentPending(maxAgeMinutes = 15): Promise<number> {
        const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

        // Fetch stale orders so we can decrement their active order counters
        const { data: staleOrders, error: fetchErr } = await supabase
            .from('orders')
            .select('id, vendor_id, event_id')
            .eq('status', OrderStatus.PAYMENT_PENDING)
            .lt('created_at', cutoff)
            .limit(200);

        if (fetchErr || !staleOrders || staleOrders.length === 0) {
            return 0;
        }

        const staleIds = staleOrders.map((o: any) => o.id);

        // Batch cancel
        const { error: updateErr } = await supabase
            .from('orders')
            .update({ status: OrderStatus.CANCELLED, payment_status: 'expired' })
            .in('id', staleIds);

        if (updateErr) {
            console.error('Failed to cancel stale orders:', updateErr.message);
            return 0;
        }

        // Decrement active orders counters (fire-and-forget, best-effort)
        for (const order of staleOrders) {
            if (order.event_id) {
                void (async () => {
                    const { error: decErr } = await supabase.rpc('decrement_active_orders', {
                        p_vendor_id: order.vendor_id,
                        p_event_id: order.event_id,
                    });
                    if (decErr) console.error('Failed to decrement for stale order:', decErr.message);
                })();
            }
        }

        console.log(`Cleaned up ${staleIds.length} stale PAYMENT_PENDING orders`);
        return staleIds.length;
    }

    /**
     * Get available time slots for a vendor within an event
     */
    async getAvailableTimeSlots(
        vendorId: string,
        eventId: string,
        slotDurationMinutes: number = 30
    ): Promise<{
        slots: Array<{
            startTime: string;
            endTime: string;
            available: boolean;
            queueLength: number;
        }>;
    }> {
        return this.scheduler.getAvailableTimeSlots(vendorId, eventId, slotDurationMinutes);
    }

    /**
     * Validate if a scheduled pickup time is feasible
     */
    async validateScheduledPickupTime(
        vendorId: string,
        eventId: string,
        scheduledPickupTime: string
    ): Promise<{
        isValid: boolean;
        error?: string;
        estimatedReadyTime?: string;
        queuePosition?: number;
    }> {
        // Fetch vendor prep time
        const { data: vendor } = await supabase
            .from('vendors')
            .select('estimated_prep_time')
            .eq('id', vendorId)
            .single();

        const estimatedPrepTime = vendor?.estimated_prep_time || 12;

        return this.scheduler.validateScheduledOrder(
            vendorId,
            eventId,
            scheduledPickupTime,
            estimatedPrepTime
        );
    }
}
