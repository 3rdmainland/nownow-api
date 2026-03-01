import {Order, OrderStatus, OrderType, PaginationParams, PaginatedResponse, OrderStats} from "./order.types";
import {supabase} from "../lib/supabase";
import { WhatsappService } from "../whatsapp/whatsapp.service";
import { QRHelper } from '../lib/qr.helper';
import { OrderScheduler } from './order.scheduler';
import { broadcastOrderStatusUpdate, broadcastNewOrder, broadcastToVendor } from "../websocket";
import { DiscountService } from "../discount/discount.service.js";
import { ValidationError } from "../lib/errors.js";
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
}

export class OrderService {
    private scheduler: OrderScheduler;

    constructor() {
        this.scheduler = new OrderScheduler();
    }

    async getAllOrders(params?: { vendorId?: string; eventId?: string; status?: string; pagination?: PaginationParams }): Promise<PaginatedResponse<Order>> {
        const page = Math.max(1, Number(params?.pagination?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(params?.pagination?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        let query = supabase.from("orders").select("*", { count: 'exact' });

        if (params?.vendorId) query = query.eq('vendor_id', params.vendorId);
        if (params?.eventId)  query = query.eq('event_id', params.eventId);
        if (params?.status)   query = query.eq('status', params.status);

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
    ): Promise<Order> {
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
                          'event_open_time, event_close_time, operating_schedule'
                      )
                      .eq('vendor_id', order.vendor_id)
                      .eq('event_id', order.event_id)
                      .single()
                : Promise.resolve({ data: null, error: null }),
        ]);

        const { data: vendor, error: vendorError } = vendorResult;
        if (vendorError || !vendor) {
            throw new Error(`Failed to fetch vendor info: ${vendorError?.message || 'Vendor not found'}`);
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
                    throw new Error('This event has not started yet.');
                }
                if (now > endDate) {
                    throw new Error('This event has ended. Orders are no longer accepted.');
                }
            }

            const menuConfig = menuConfigResult.data as EventMenuConfig | null;

            if (menuConfig) {
                // 1. Check if vendor is accepting orders
                if (!menuConfig.is_accepting_orders) {
                    throw new Error('This vendor is not currently accepting orders.');
                }

                // 2. Check menu status (PAUSED or CLOSED blocks orders)
                if (menuConfig.status === 'PAUSED') {
                    throw new Error('This vendor has temporarily paused orders. Please try again shortly.');
                }
                if (menuConfig.status === 'CLOSED') {
                    throw new Error('This vendor has closed for this event.');
                }

                // 3. Check max concurrent orders
                if (
                    menuConfig.max_concurrent_orders !== null &&
                    menuConfig.max_concurrent_orders !== undefined &&
                    menuConfig.current_active_orders >= menuConfig.max_concurrent_orders
                ) {
                    throw new Error(
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
                        throw new Error(
                            `This vendor is managing order flow. ` +
                            `Please try again in ${waitSecs < 60 ? `${waitSecs}s` : `${Math.ceil(waitSecs / 60)}m`}.`
                        );
                    }

                    // 5. Max orders per customer check
                    if (menuConfig.max_orders_per_customer_event && order.phone) {
                        const count = (maxOrdersResult as any).count;
                        if (count !== null && count >= menuConfig.max_orders_per_customer_event) {
                            throw new Error(
                                `You have reached the maximum of ${menuConfig.max_orders_per_customer_event} ` +
                                `order(s) allowed per customer at this event.`
                            );
                        }
                    }
                }

                // 6. Check event operating hours — per-day schedule first, then daily default
                {
                    const now = new Date();
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    const currentHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
                    const todayDate = now.toISOString().split('T')[0]; // YYYY-MM-DD

                    const todaySchedule = (menuConfig.operating_schedule as any[] | null)
                        ?.find((s: any) => s.date === todayDate);

                    if (todaySchedule) {
                        // Per-day entry exists — use it
                        if (todaySchedule.isClosed) {
                            throw new Error('This vendor is not operating today.');
                        }
                        if (todaySchedule.openTime && todaySchedule.closeTime) {
                            if (currentHHMM < todaySchedule.openTime || currentHHMM >= todaySchedule.closeTime) {
                                throw new Error(
                                    `This vendor operates ${todaySchedule.openTime} – ${todaySchedule.closeTime} today.`
                                );
                            }
                        }
                    } else if (menuConfig.event_open_time && menuConfig.event_close_time) {
                        // Fall back to daily default
                        if (currentHHMM < menuConfig.event_open_time || currentHHMM >= menuConfig.event_close_time) {
                            throw new Error(
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
                throw new Error(`Invalid scheduled order: ${validationResult.error}`);
            }
        } else {
            // Validate immediate order
            validationResult = await this.scheduler.validateImmediateOrder(
                order.vendor_id,
                order.event_id,
                estimatedPrepTime
            );

            if (!validationResult.isValid) {
                throw new Error(`Cannot place order: ${validationResult.error}`);
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
            throw new Error(
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

        // Strip internal fields before inserting into DB
        const { _minimumOrderValue, _serviceFeePercent, ...cleanOrder } = order as any;

        // Set defaults including estimated prep time and scheduling data
        const orderWithDefaults = {
            ...cleanOrder,
            items: validatedItems,
            total: Math.round(validatedTotal * 100) / 100,
            ...(serviceFee > 0 ? { service_fee: serviceFee } : {}),
            status: OrderStatus.PENDING,
            type: OrderType.CART,
            estimated_prep_time: estimatedPrepTime,
            qr_code: `PENDING-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            qr_image: '',
            queue_position: validationResult.queuePosition,
            estimated_ready_time: validationResult.estimatedReadyTime,
        };

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

        // Fire-and-forget WhatsApp notification
        try {
            const token = process.env.WA_ACCESS_TOKEN;
            if (token && updatedOrder?.phone) {
                const whatsapp = new WhatsappService();

                void whatsapp
                    .sendOrderPlacedTemplate(updatedOrder.phone, {
                        orderId: String(updatedOrder.id),
                        total: order.total.toString(),
                        prepTimeMinutes: String(estimatedPrepTime),
                        qrImageUrl: qr_image,
                    })
                    .catch((err) => {
                        console.error('Failed to send WhatsApp notification:', err?.message || err);
                    });
            }
        } catch (notifyErr) {
            console.error('WhatsApp notification error (non-fatal):', (notifyErr as any)?.message || notifyErr);
        }

        // Notify the vendor's live panel in real time
        broadcastNewOrder({
            orderId: updatedOrder.id,
            vendorId: updatedOrder.vendor_id,
            eventId: updatedOrder.event_id,
        });

        return updatedOrder;
    }

    /**
     * Confirms order collection by scanning QR code
     * Updates status to COLLECTED and sends confirmation WhatsApp
     */
    async confirmCollectionByQR(qrCode: string, vendorId: string): Promise<Order> {
        const qrHelper = new QRHelper();
        const orderId = qrHelper.parseQRCode(qrCode);

        if (!orderId) {
            throw new Error('Invalid QR code format');
        }

        // Fetch the order
        const { data: order, error: fetchError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .eq('vendor_id', vendorId)
            .eq('status', OrderStatus.READY)
            .single();

        if (fetchError || !order) {
            throw new Error(`Order not found: ${fetchError?.message || 'Unknown error'}`);
        }

        // Validate order can be collected (must be READY)
        if (order.status !== OrderStatus.READY) {
            throw new Error(`Order cannot be collected. Current status: ${order.status}`);
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

        // Fetch vendor name for WhatsApp message
        const { data: vendor } = await supabase
            .from('vendors')
            .select('name')
            .eq('id', order.vendor_id)
            .single();

        // Send collection confirmation via WhatsApp
        try {
            const token = process.env.WA_ACCESS_TOKEN;
            if (token && order.phone) {
                const whatsapp = new WhatsappService();

                void whatsapp
                    .sendOrderCollectedTemplate(order.phone, {
                        orderId: String(orderId),
                        vendorName: vendor?.name || 'the vendor',
                    })
                    .catch((err) => {
                        console.error('Failed to send collection confirmation:', err?.message || err);
                    });
            }
        } catch (notifyErr) {
            console.error('WhatsApp notification error (non-fatal):', (notifyErr as any)?.message || notifyErr);
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

        // Cancellation is only allowed from PENDING status
        if (status === OrderStatus.CANCELLED && currentOrder.status !== OrderStatus.PENDING) {
            throw new ValidationError('Order can only be cancelled before it starts preparing', {
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
                if (token && data.phone) {
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

    async getOrdersByPhone(phone: string, pagination?: PaginationParams): Promise<PaginatedResponse<Order>> {
        const page = Math.max(1, Number(pagination?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(pagination?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        const { data, error, count } = await supabase
            .from('orders')
            .select('*', { count: 'exact' })
            .eq('phone', phone)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            throw new Error(`Failed to fetch orders by phone: ${error.message}`);
        }

        const total = count || 0;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        return { orders: data || [], page, pageSize, total, totalPages };
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
            .lte('created_at', endDate)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            throw new Error(`Failed to fetch orders by date range: ${error.message}`);
        }

        const total = count || 0;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        return { orders: data || [], page, pageSize, total, totalPages };
    }

    async getOrderStats(vendorId?: string, eventId?: string): Promise<OrderStats> {
        const cacheKey = `order:stats:${vendorId || 'all'}:${eventId || 'all'}`;
        const cached = await cache.get<OrderStats>(cacheKey);
        if (cached) return cached;

        // Parallel queries: summary stats (no items) + items for top-item calc
        let summaryQuery = supabase.from('orders').select('total, status, payment_method');
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

        // Payment method breakdown (non-cancelled)
        const paymentBreakdown: Record<string, number> = {};
        nonCancelled.forEach((o: any) => {
            const method = o.payment_method ?? 'Unknown';
            paymentBreakdown[method] = (paymentBreakdown[method] || 0) + Number(o.total);
        });

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
        };

        await cache.set(cacheKey, stats, CACHE_TTL.ITEM_AVAILABILITY); // 10s TTL
        return stats;
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
