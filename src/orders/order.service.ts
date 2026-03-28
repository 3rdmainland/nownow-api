import {Order, OrderStatus, OrderType, PaginationParams, PaginatedResponse, OrderStats, TimeSeriesGranularity, TimeSeriesStats, TimeSeriesBucket, TimeSeriesSummary, PreviousPeriodSummary, RefundOrderDto} from "./order.types";
import {supabase} from "../lib/supabase";
import { WhatsappService } from "../whatsapp/whatsapp.service";
import { QRHelper } from '../lib/qr.helper';
import { OrderScheduler } from './order.scheduler';
import { broadcastOrderStatusUpdate, broadcastNewOrder, broadcastToVendor, broadcastAdminOrderFeed, broadcastToAdmins } from "../websocket";
import { DiscountService } from "../discount/discount.service.js";
import { paymentService } from "../payment/payment.service.js";
import { ValidationError, NotFoundError, ForbiddenError, TooManyRequestsError, ConflictError } from "../lib/errors.js";
import { cache, CACHE_TTL } from "../lib/redis";

interface EventMenuConfig {
    is_accepting_orders: boolean;
    status: string;
    max_concurrent_orders: number | null;
    current_active_orders: number;
    order_cooldown_minutes: number | null;
    max_orders_per_customer_event: number | null;
    prep_time_buffer_minutes: number | null;
    event_open_time: string | null;
    event_close_time: string | null;
    operating_schedule: any[] | null;
    allow_pay_at_stall: boolean;
}

export class OrderService {
    private scheduler: OrderScheduler;

    constructor() {
        this.scheduler = new OrderScheduler();
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
        return { orders: data || [], page, pageSize, total, totalPages };
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

        return data || null;
    }

    async createOrder(
        order: Omit<Order, 'id' | 'created_at' | 'status' | 'type' | 'estimatedPrepTime' | 'qr_image' | 'qr_code'>
    ): Promise<Order & { paymentUrl: string }> {
        const qrHelper = new QRHelper();

        // ── Parallel fetch: vendor, event dates, menu config ─────────────
        const [vendorResult, eventDataResult, menuConfigResult] = await Promise.all([
            supabase
                .from('vendors')
                .select('estimated_prep_time, name, minimum_order, service_fee_percent')
                .eq('id', order.vendor_id)
                .single(),
            order.event_id
                ? supabase.from('events').select('start_date, end_date').eq('id', order.event_id).single()
                : Promise.resolve({ data: null, error: null }),
            order.event_id
                ? supabase
                      .from('event_menu_configurations')
                      .select(
                          'is_accepting_orders, status, max_concurrent_orders, current_active_orders, ' +
                          'order_cooldown_minutes, max_orders_per_customer_event, prep_time_buffer_minutes, ' +
                          'event_open_time, event_close_time, operating_schedule, allow_pay_at_stall'
                      )
                      .eq('vendor_id', order.vendor_id)
                      .eq('event_id', order.event_id)
                      .single()
                : Promise.resolve({ data: null, error: null }),
        ]);

        const { data: vendor, error: vendorError } = vendorResult;
        if (vendorError || !vendor) {
            throw new NotFoundError('Vendor not found');
        }

        let estimatedPrepTime = vendor.estimated_prep_time || 12;

        // ── Enforce event menu configuration rules ───────────────────────
        if (order.event_id) {
            const eventData = eventDataResult.data;

            if (eventData) {
                const now = new Date();
                const startDate = new Date(eventData.start_date);
                const endDate = new Date(eventData.end_date);
                endDate.setHours(23, 59, 59, 999); // inclusive of the end day

                if (now < startDate) {
                    throw new ValidationError('This event has not started yet.');
                }
                if (now > endDate) {
                    throw new ValidationError('This event has ended. Orders are no longer accepted.');
                }
            }

            const menuConfig = menuConfigResult.data as EventMenuConfig | null;

            if (menuConfig) {
                // 1. Check if vendor is accepting orders
                if (!menuConfig.is_accepting_orders) {
                    throw new ValidationError('This vendor is not currently accepting orders.');
                }

                // 2. Check menu status (PAUSED or CLOSED blocks orders)
                if (menuConfig.status === 'PAUSED') {
                    throw new ValidationError('This vendor has temporarily paused orders. Please try again shortly.');
                }
                if (menuConfig.status === 'CLOSED') {
                    throw new ValidationError('This vendor has closed for this event.');
                }

                // 3. Check max concurrent orders
                if (
                    menuConfig.max_concurrent_orders !== null &&
                    menuConfig.max_concurrent_orders !== undefined &&
                    menuConfig.current_active_orders >= menuConfig.max_concurrent_orders
                ) {
                    throw new ValidationError(
                        `This vendor is at capacity (${menuConfig.max_concurrent_orders} concurrent orders). ` +
                        'Please wait a few minutes and try again.'
                    );
                }

                // 4 & 5: Parallel checks — cooldown + max orders per customer
                {
                    const cooldownPromise = menuConfig.order_cooldown_minutes
                        ? supabase
                              .from('orders')
                              .select('id, created_at')
                              .eq('vendor_id', order.vendor_id)
                              .eq('event_id', order.event_id)
                              .gte('created_at', new Date(Date.now() - menuConfig.order_cooldown_minutes * 60 * 1000).toISOString())
                              .limit(1)
                        : Promise.resolve({ data: null });

                    const maxOrdersPromise = (menuConfig.max_orders_per_customer_event && order.phone)
                        ? supabase
                              .from('orders')
                              .select('id', { count: 'exact', head: true })
                              .eq('vendor_id', order.vendor_id)
                              .eq('event_id', order.event_id)
                              .eq('phone', order.phone)
                        : Promise.resolve({ count: null });

                    const [cooldownResult, maxOrdersResult] = await Promise.all([cooldownPromise, maxOrdersPromise]);

                    // 4. Cooldown check
                    if (menuConfig.order_cooldown_minutes && cooldownResult.data && (cooldownResult.data as any[]).length > 0) {
                        const cooldownMs = menuConfig.order_cooldown_minutes * 60 * 1000;
                        const recentOrders = cooldownResult.data as any[];
                        const lastOrderTime = new Date(recentOrders[0].created_at);
                        const nextAvailable = new Date(lastOrderTime.getTime() + cooldownMs);
                        const waitSecs = Math.ceil((nextAvailable.getTime() - Date.now()) / 1000);
                        throw new TooManyRequestsError(
                            `This vendor is managing order flow. ` +
                            `Please try again in ${waitSecs < 60 ? `${waitSecs}s` : `${Math.ceil(waitSecs / 60)}m`}.`
                        );
                    }

                    // 5. Max orders per customer check
                    if (menuConfig.max_orders_per_customer_event && order.phone) {
                        const count = (maxOrdersResult as any).count;
                        if (count !== null && count >= menuConfig.max_orders_per_customer_event) {
                            throw new ValidationError(
                                `You have reached the maximum of ${menuConfig.max_orders_per_customer_event} ` +
                                `order(s) allowed per customer at this event.`
                            );
                        }
                    }
                }

                // 6. Check event operating hours at the relevant time
                // For scheduled orders → check the pickup date/time
                // For immediate orders → check now
                {
                    const checkTime = order.scheduled_pickup_time
                        ? new Date(order.scheduled_pickup_time)
                        : new Date();
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    const checkHHMM = `${pad(checkTime.getUTCHours())}:${pad(checkTime.getUTCMinutes())}`;
                    const checkDate = checkTime.toISOString().split('T')[0]; // YYYY-MM-DD (UTC)

                    const daySchedule = (menuConfig.operating_schedule as any[] | null)
                        ?.find((s: any) => s.date === checkDate);

                    if (daySchedule) {
                        // Per-day entry exists — use it
                        if (daySchedule.isClosed) {
                            throw new ValidationError(
                                order.scheduled_pickup_time
                                    ? `This vendor is not operating on ${checkDate}.`
                                    : 'This vendor is not operating today.'
                            );
                        }
                        if (daySchedule.openTime && daySchedule.closeTime && daySchedule.openTime !== daySchedule.closeTime) {
                            if (checkHHMM < daySchedule.openTime || checkHHMM >= daySchedule.closeTime) {
                                throw new ValidationError(
                                    `This vendor operates ${daySchedule.openTime} – ${daySchedule.closeTime} on ${checkDate}.`
                                );
                            }
                        }
                    } else if (menuConfig.event_open_time && menuConfig.event_close_time && menuConfig.event_open_time !== menuConfig.event_close_time) {
                        // Fall back to daily default
                        if (checkHHMM < menuConfig.event_open_time || checkHHMM >= menuConfig.event_close_time) {
                            throw new ValidationError(
                                `This vendor is only accepting orders between ${menuConfig.event_open_time} and ${menuConfig.event_close_time}.`
                            );
                        }
                    }
                }

                // 7. Apply prep time buffer (extra minutes on top of vendor default)
                if (menuConfig.prep_time_buffer_minutes) {
                    estimatedPrepTime += menuConfig.prep_time_buffer_minutes;
                }
            }
        }

        // ── Vendor-level defaults (minimum order, service fee) ────────────
        (order as any)._minimumOrderValue = vendor.minimum_order ?? null;
        (order as any)._serviceFeePercent = vendor.service_fee_percent ?? null;
        // ─────────────────────────────────────────────────────────────────

        // Validate scheduled order if pickup time is provided
        let validationResult;
        if (order.scheduled_pickup_time) {
            validationResult = await this.scheduler.validateScheduledOrder(
                order.vendor_id,
                order.event_id,
                order.scheduled_pickup_time,
                estimatedPrepTime
            );

            if (!validationResult.isValid) {
                throw new ValidationError(`Invalid scheduled order: ${validationResult.error}`);
            }
        } else {
            // Validate immediate order
            validationResult = await this.scheduler.validateImmediateOrder(
                order.vendor_id,
                order.event_id,
                estimatedPrepTime
            );

            if (!validationResult.isValid) {
                throw new ValidationError(`Cannot place order: ${validationResult.error}`);
            }
        }

        // Server-side discount validation: batch-resolve all discounts in 1 DB query
        const discountService = new DiscountService();
        const discountInputs = order.items.map((item: any) => ({
            itemId: item.id,
            price: item.originalPrice ?? item.basePrice ?? item.price,
        }));
        const discountMap = await discountService.resolveDiscountsForMenu(
            order.event_id,
            order.vendor_id,
            discountInputs
        );

        const validatedItems = order.items.map((item: any) => {
            const basePrice = item.basePrice ?? item.price;
            const priceForDiscount = item.originalPrice ?? basePrice;
            const resolvedDiscount = discountMap.get(item.id);

            if (resolvedDiscount) {
                const modifierDelta = item.price - basePrice;
                const serverPrice = Math.max(0, Math.round((resolvedDiscount.discountedPrice + modifierDelta) * 100) / 100);
                return {
                    ...item,
                    price: serverPrice,
                    originalPrice: priceForDiscount + modifierDelta,
                    discountId: resolvedDiscount.discountId,
                    discountSavings: resolvedDiscount.savings,
                };
            }
            return item;
        });

        let validatedTotal = validatedItems.reduce(
            (sum: number, item: any) => sum + (item.price * item.quantity), 0
        );

        // 7. Check minimum order value
        const minimumOrderValue = (order as any)._minimumOrderValue;
        if (minimumOrderValue && validatedTotal < minimumOrderValue) {
            throw new ValidationError(
                `Minimum order value is R${minimumOrderValue.toFixed(2)}. ` +
                `Your order total is R${validatedTotal.toFixed(2)}.`
            );
        }

        // 8. Apply service fee
        const serviceFeePercent = (order as any)._serviceFeePercent;
        let serviceFee = 0;
        if (serviceFeePercent) {
            serviceFee = Math.round(validatedTotal * (serviceFeePercent / 100) * 100) / 100;
            validatedTotal = Math.round((validatedTotal + serviceFee) * 100) / 100;
        }

        // Strip internal fields and map camelCase to snake_case before inserting into DB
        const { _minimumOrderValue, _serviceFeePercent, paymentMethod, ...cleanOrder } = order as any;

        // Determine if this is a cash (pay-at-stall) order
        const menuConfig = menuConfigResult.data as EventMenuConfig | null;
        const isCashOrder = paymentMethod === 'CASH';

        // Validate cash orders are allowed
        if (isCashOrder && (!menuConfig || !menuConfig.allow_pay_at_stall)) {
            throw new ValidationError('Pay at stall is not available for this vendor at this event.');
        }

        // Set defaults including estimated prep time and scheduling data
        const orderWithDefaults = {
            ...cleanOrder,
            payment_method: isCashOrder ? 'CASH' : (paymentMethod || cleanOrder.payment_method || 'ONLINE'),
            items: validatedItems,
            total: Math.round(validatedTotal * 100) / 100,
            ...(serviceFee > 0 ? { service_fee: serviceFee } : {}),
            status: isCashOrder ? OrderStatus.PENDING : OrderStatus.PAYMENT_PENDING,
            payment_status: isCashOrder ? ('pay_at_stall' as const) : ('pending' as const),
            type: isCashOrder ? OrderType.ORDER : OrderType.CART,
            estimated_prep_time: estimatedPrepTime,
            qr_code: `PENDING-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            qr_image: '',
            queue_position: validationResult.queuePosition,
            estimated_ready_time: validationResult.estimatedReadyTime,
            age_verified: cleanOrder.age_verified || false,
            age_verified_at: cleanOrder.age_verified ? new Date().toISOString() : null,
        };

        // Dedup guard: reject if an identical order was created in the last 30 seconds
        if (orderWithDefaults.phone && orderWithDefaults.vendor_id) {
            const cutoff = new Date(Date.now() - 30_000).toISOString();
            let dupQuery = supabase
                .from('orders')
                .select('id', { count: 'exact', head: true })
                .eq('phone', orderWithDefaults.phone)
                .eq('vendor_id', orderWithDefaults.vendor_id)
                .eq('total', orderWithDefaults.total)
                .gte('created_at', cutoff);
            if (orderWithDefaults.event_id) {
                dupQuery = dupQuery.eq('event_id', orderWithDefaults.event_id);
            }
            const { count: dupCount } = await dupQuery;
            if (dupCount && dupCount > 0) {
                throw new ConflictError('A duplicate order was detected. Please wait a moment before ordering again.');
            }
        }

        const { data: createdOrder, error } = await supabase
            .from('orders')
            .insert([orderWithDefaults])
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to create order: ${error.message}`);
        }

        const { qr_code, qr_image } = await qrHelper.generateAndUploadQRCode(createdOrder.id);

        // Update order with QR code data
        const { data: updatedOrder, error: updateError } = await supabase
            .from('orders')
            .update({ qr_code, qr_image })
            .eq('id', createdOrder.id)
            .select()
            .single();

        if (updateError) {
            throw new Error(`Failed to update order with QR code: ${updateError.message}`);
        }

        // Fire-and-forget: update queue positions for other pending orders
        this.scheduler.updateQueuePositions(order.vendor_id).catch(err =>
            console.error('Failed to update queue positions:', err?.message || err)
        );

        // Cash order: skip Stitch, send notifications immediately
        if (isCashOrder) {
            this.sendOrderNotifications(updatedOrder).catch(err =>
                console.error('Failed to send cash order notifications:', err?.message || err)
            );
            return { ...updatedOrder, paymentUrl: '' };
        }

        // Online order: look up customer name for payment (required by Stitch)
        let payerName: string | null = null;
        if (order.customer_id) {
            const { data: customer } = await supabase
                .from('customers')
                .select('name')
                .eq('id', order.customer_id)
                .single();
            if (customer?.name) payerName = customer.name;
        }
        if (!payerName) {
            throw new ValidationError('Customer name is required for online payment. Please update your profile.');
        }

        const { paymentId, paymentUrl } = await paymentService.createPaymentRequest(
            updatedOrder.id,
            Math.round(validatedTotal * 100), // Convert rands to cents
            payerName,
            order.phone
        );

        // Store payment reference on order
        await supabase
            .from('orders')
            .update({ stitch_payment_id: paymentId })
            .eq('id', updatedOrder.id);

        return { ...updatedOrder, paymentUrl };
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
                const whatsapp = new WhatsappService();

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

                        const whatsapp = new WhatsappService();
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

        return updatedOrder;
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

                    const whatsapp = new WhatsappService();

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

        return data;
    }

    async getOrdersByVendor(vendorId: string, pagination?: PaginationParams): Promise<PaginatedResponse<Order>> {
        const page = Math.max(1, Number(pagination?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(pagination?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        const { data, error, count } = await supabase
            .from('orders')
            .select('*', { count: 'exact' })
            .eq('vendor_id', vendorId)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            throw new Error(`Failed to fetch vendor orders: ${error.message}`);
        }

        const total = count || 0;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        return { orders: data || [], page, pageSize, total, totalPages };
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
        return { orders, page, pageSize, total, totalPages };
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
        return { orders, page, pageSize, total, totalPages };
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
        return { orders: data || [], page, pageSize, total, totalPages };
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

        return data || [];
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
        return { orders: data || [], page, pageSize, total, totalPages };
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

        // Invalidate cached stats
        const patterns = [
            `order:stats:${order.vendor_id}:`,
            `order:stats:all:`,
            `order:timeseries:${order.vendor_id}:`,
            `order:timeseries:all:`,
        ];
        for (const prefix of patterns) {
            await cache.del(prefix + '*').catch(() => {});
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
        return { orders: data || [], page, pageSize, total, totalPages };
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
        return { orders: data || [], page, pageSize, total, totalPages };
    }

    async health(): Promise<void> {
        const { error } = await supabase.from("orders").select("count");

        if (error) {
            throw new Error(`Failed to find order: ${error.message}`);
        }
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
