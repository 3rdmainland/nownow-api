import {Order, OrderStatus, OrderType} from "./order.types";
import {supabase} from "../lib/supabase";
import { WhatsappService } from "../whatsapp/whatsapp.service";
import { QRHelper } from '../lib/qr.helper';
import { OrderScheduler } from './order.scheduler';
import { broadcastOrderStatusUpdate } from "../websocket";
import { DiscountService } from "../discount/discount.service.js";

export class OrderService {
    private scheduler: OrderScheduler;

    constructor() {
        this.scheduler = new OrderScheduler();
    }

    async getAllOrders(): Promise<Order[]> {
        const { data, error } = await supabase
            .from("orders")
            .select("*")

        if (error) {
            throw new Error(`Failed to fetch orders: ${error.message}`);
        }

        return data || [];
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
        // Fetch vendor details including name
        const { data: vendor, error: vendorError } = await supabase
            .from('vendors')
            .select('estimated_prep_time, name')
            .eq('id', order.vendor_id)
            .single();

        if (vendorError || !vendor) {
            throw new Error(`Failed to fetch vendor info: ${vendorError?.message || 'Vendor not found'}`);
        }

        const estimatedPrepTime = vendor.estimated_prep_time || 12;

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

        // Server-side discount validation: re-resolve discounts and recompute prices
        const discountService = new DiscountService();
        const validatedItems = await Promise.all(
            order.items.map(async (item: any) => {
                const basePrice = item.basePrice ?? item.price;
                const resolvedDiscount = await discountService.resolveDiscount(
                    order.event_id,
                    item.vendorId || order.vendor_id,
                    item.id,
                    basePrice
                );

                if (resolvedDiscount) {
                    // Preserve modifier delta (difference between submitted price and base)
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
            })
        );

        const validatedTotal = validatedItems.reduce(
            (sum: number, item: any) => sum + (item.price * item.quantity), 0
        );

        // Set defaults including estimated prep time and scheduling data
        const orderWithDefaults = {
            ...order,
            items: validatedItems,
            total: Math.round(validatedTotal * 100) / 100,
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

        // Update queue positions for other pending orders
        await this.scheduler.updateQueuePositions(order.vendor_id);

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

        // Update queue positions when order completes
        if (status === OrderStatus.COLLECTED || status === OrderStatus.READY) {
            await this.scheduler.updateQueuePositions(currentOrder.vendor_id);
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

        // Broadcast order status update via WebSocket
        if (data.phone) {
            broadcastOrderStatusUpdate({
                orderId: data.id,
                phone: data.phone,
                status: data.status,
                vendorId: data.vendor_id,
                eventId: data.event_id,
            });
        }

        return data;
    }

    async getOrdersByVendor(vendorId: string): Promise<Order[]> {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('vendor_id', vendorId)
            .order('created_at', { ascending: false })

        if (error) {
            throw new Error(`Failed to fetch vendor orders: ${error.message}`);
        }

        return data || [];
    }

    async getOrdersByPhone(phone: string): Promise<Order[]> {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('phone', phone)
            .order('created_at', { ascending: false })

        if (error) {
            throw new Error(`Failed to fetch orders by phone: ${error.message}`);
        }

        return data || [];
    }

    async getOrdersByStatus(status: string): Promise<Order[]> {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('status', status)
            .order('created_at', { ascending: false })

        if (error) {
            throw new Error(`Failed to fetch orders by status: ${error.message}`);
        }

        return data || [];
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

    async getOrdersByDateRange(startDate: string, endDate: string): Promise<Order[]> {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .gte('created_at', startDate)
            .lte('created_at', endDate)
            .order('created_at', { ascending: false })

        if (error) {
            throw new Error(`Failed to fetch orders by date range: ${error.message}`);
        }

        return data || [];
    }

    async getOrderStats(vendorId?: string, eventId?: string): Promise<{
        totalOrders: number;
        totalRevenue: number;
        averageOrderValue: number;
        ordersByStatus: Record<string, number>;
    }> {
        let query = supabase.from('orders').select('*');

        if (vendorId) {
            query = query.eq('vendor_id', vendorId);
        }
        if (eventId) {
            query = query.eq('event_id', eventId);
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(`Failed to fetch order stats: ${error.message}`);
        }

        const orders = data || [];

        const stats = {
            totalOrders: orders.length,
            totalRevenue: orders.reduce((sum, order) => sum + order.total, 0),
            averageOrderValue: orders.length > 0
                ? orders.reduce((sum, order) => sum + order.total, 0) / orders.length
                : 0,
            ordersByStatus: orders.reduce((acc, order) => {
                acc[order.status] = (acc[order.status] || 0) + 1;
                return acc;
            }, {} as Record<string, number>)
        };

        return stats;
    }

    async getOrdersByEvent(eventId: string): Promise<Order[]> {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false })

        if (error) {
            throw new Error(`Failed to fetch event orders: ${error.message}`);
        }

        return data || [];
    }

    async searchOrders(searchTerm: string, eventId?: string): Promise<Order[]> {
        let query = supabase
            .from('orders')
            .select('*');

        if (eventId) {
            query = query.eq('event_id', eventId);
        }

        const { data, error } = await query
            .or(`phone.ilike.%${searchTerm}%,qr_code.ilike.%${searchTerm}%,id.ilike.%${searchTerm}%`)
            .order('created_at', { ascending: false });

        if (error) {
            throw new Error(`Failed to search orders: ${error.message}`);
        }

        return data || [];
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
