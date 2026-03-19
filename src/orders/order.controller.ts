import { FastifyPluginAsync } from "fastify";
import {
    getOrderByIdResponseSchema,
    getOrdersResponseSchema,
    createOrderSchema,
    updateOrderStatusSchema,
    getOrdersByVendorSchema,
    getOrdersByPhoneSchema,
    getOrdersByStatusSchema,
    getRecentOrdersSchema,
    deleteOrderSchema,
    getOrdersByDateRangeSchema,
    getOrderStatsSchema,
    getTimeSeriesStatsSchema,
    searchOrdersSchema,
    getOrdersByEventSchema,
    confirmCollectionSchema,
    getAvailableTimeSlotsSchema,
    validateScheduledPickupSchema,
    checkoutOptionsSchema,
    refundOrderSchema,
    getOrdersByCustomerSchema,
} from "./order.schema";
import { OrderService } from "./order.service";
import {OrderStatus} from "./order.types";
import {supabase} from "../lib/supabase";
import { authenticate, authenticateCustomer, optionalAuthenticateCustomer } from "../lib/auth.js";

const orderController: FastifyPluginAsync = async (fastify) => {
    const orderService = new OrderService();

    // Get all orders (supports ?vendorId=&eventId=&status=&startDate=&endDate=&page=&pageSize= filters)
    fastify.get("/", { schema: getOrdersResponseSchema }, async (request, reply) => {
        try {
            const { vendorId, eventId, status, startDate, endDate, page, pageSize } = request.query as {
                vendorId?: string; eventId?: string; status?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number;
            };
            const result = await orderService.getAllOrders({ vendorId, eventId, status, startDate, endDate, pagination: { page, pageSize } });
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get recent orders
    fastify.get("/recent", { schema: getRecentOrdersSchema }, async (request, reply) => {
        try {
            const { limit = 10 } = request.query as { limit?: number };
            const orders = await orderService.getRecentOrders(limit);
            return { orders };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get time-series order statistics
    fastify.get("/stats/timeseries", { schema: getTimeSeriesStatsSchema }, async (request, reply) => {
        try {
            const { vendorId, eventId, startDate, endDate, granularity = 'day' } = request.query as {
                vendorId?: string; eventId?: string; startDate: string; endDate: string; granularity?: 'day' | 'week' | 'month';
            };
            const stats = await orderService.getTimeSeriesStats({ vendorId, eventId, startDate, endDate, granularity });
            return stats;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get order statistics
    fastify.get("/stats", { schema: getOrderStatsSchema }, async (request, reply) => {
        try {
            const { vendorId, eventId } = request.query as { vendorId?: string, eventId?: string };
            const stats = await orderService.getOrderStats(vendorId, eventId);
            return stats;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Search orders
    fastify.get("/search", { schema: searchOrdersSchema }, async (request, reply) => {
        try {
            const { q, eventId, page, pageSize } = request.query as { q: string; eventId?: string; page?: number; pageSize?: number };
            const result = await orderService.searchOrders(q, eventId, { page, pageSize });
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get orders by phone
    fastify.get("/phone", { schema: getOrdersByPhoneSchema }, async (request, reply) => {
        try {
            const { phone, eventId, page, pageSize } = request.query as { phone: string; eventId?: string; page?: number; pageSize?: number };
            const result = await orderService.getOrdersByPhone(phone, { page, pageSize }, eventId);
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get orders by status
    fastify.get("/status", { schema: getOrdersByStatusSchema }, async (request, reply) => {
        try {
            const { status, page, pageSize } = request.query as { status: string; page?: number; pageSize?: number };
            const result = await orderService.getOrdersByStatus(status, { page, pageSize });
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get orders by date range
    fastify.get("/date-range", { schema: getOrdersByDateRangeSchema }, async (request, reply) => {
        try {
            const { startDate, endDate, page, pageSize } = request.query as { startDate: string; endDate: string; page?: number; pageSize?: number };
            const result = await orderService.getOrdersByDateRange(startDate, endDate, { page, pageSize });
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get orders by vendor
    fastify.get("/vendor/:vendorId", { schema: getOrdersByVendorSchema }, async (request, reply) => {
        try {
            const { vendorId } = request.params as { vendorId: string };
            const { page, pageSize } = request.query as { page?: number; pageSize?: number };
            const result = await orderService.getOrdersByVendor(vendorId, { page, pageSize });
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get checkout options (pay-at-stall availability)
    fastify.get("/checkout-options", { schema: checkoutOptionsSchema }, async (request, reply) => {
        try {
            const { vendorId, eventId } = request.query as { vendorId: string; eventId: string };
            const { data, error } = await supabase
                .from('event_menu_configurations')
                .select('allow_pay_at_stall, slot_duration_minutes')
                .eq('vendor_id', vendorId)
                .eq('event_id', eventId)
                .single();

            if (error || !data) {
                return { allowPayAtStall: false };
            }

            return {
                allowPayAtStall: data.allow_pay_at_stall ?? false,
                slotDurationMinutes: data.slot_duration_minutes ?? undefined,
            };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get orders by event
    fastify.get("/event/:eventId", { schema: getOrdersByEventSchema }, async (request, reply) => {
        try {
            const { eventId } = request.params as { eventId: string };
            const { page, pageSize } = request.query as { page?: number; pageSize?: number };
            const result = await orderService.getOrdersByEvent(eventId, { page, pageSize });
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get orders for authenticated customer
    fastify.get("/customer", {
        schema: getOrdersByCustomerSchema,
        preHandler: [authenticateCustomer],
    }, async (request, reply) => {
        try {
            const { customerId } = request.user as { customerId: string };
            const { eventId, page, pageSize } = request.query as { eventId?: string; page?: number; pageSize?: number };
            const result = await orderService.getOrdersByCustomerId(customerId, { page, pageSize }, eventId);
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get order by ID
    fastify.get<{ Params: { id: string } }>("/:id", { schema: getOrderByIdResponseSchema }, async (request, reply) => {
        try {
            const order = await orderService.getOrderById(request.params.id);
            if (!order) {
                return reply.status(404).send({ error: "Order not found" });
            }
            return { order };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Create new order
    fastify.post("/", { schema: createOrderSchema, preHandler: [optionalAuthenticateCustomer] }, async (request, reply) => {
        const orderData = request.body as any;
        // Attach customer_id from JWT if authenticated
        const user = request.user as { customerId?: string; role?: string } | undefined;
        if (user?.customerId && user?.role === 'customer') {
            orderData.customer_id = user.customerId;
        }
        const result = await orderService.createOrder(orderData);
        const { paymentUrl, ...order } = result;
        return reply.status(201).send({ order, paymentUrl });
    });

    // Update order status
    fastify.patch<{ Params: { id: string } }>("/:id/status", { schema: updateOrderStatusSchema }, async (request, reply) => {
        try {
            const { id } = request.params;
            const { status } = request.body as { status: OrderStatus };
            const order = await orderService.updateOrderStatus(id, status);
            return { order };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Refund order
    fastify.post<{ Params: { id: string } }>(
        "/:id/refund",
        { schema: refundOrderSchema, preHandler: [authenticate] },
        async (request, reply) => {
            try {
                const { id } = request.params;
                const { type, amount, reason } = request.body as { type: 'full' | 'partial'; amount?: number; reason: string };
                const user = request.user as { email?: string; sub?: string };
                const refundedBy = user.email || user.sub || 'unknown';

                const order = await orderService.refundOrder(id, { type, amount, reason, refundedBy });
                return { order };
            } catch (err: any) {
                fastify.log.error(err);
                if (err.statusCode === 404) {
                    return reply.status(404).send({ error: err.message });
                }
                if (err.statusCode === 400) {
                    return reply.status(400).send({ error: err.message });
                }
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    // Delete order
    fastify.delete<{ Params: { id: string } }>("/:id", { schema: deleteOrderSchema }, async (request, reply) => {
        try {
            await orderService.deleteOrder(request.params.id);
            return reply.status(204).send();
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Check health
    fastify.get("/health", async (_, reply) => {
        try {

            await orderService.health();
            return reply.status(204).send();
        } catch (err) {
            return reply.status(500).send({
                status: "error",
                supabase: "disconnected",
                error: err instanceof Error ? err.message : 'Unknown error'
            });
        }
    });

    fastify.post<{ Body: { qr_code: string; vendor_id: string } }>(
        "/collect",
        { schema: confirmCollectionSchema },
        async (request, reply) => {
            try {
                const order = await orderService.confirmCollectionByQR(
                    request.body.qr_code,
                    request.body.vendor_id
                );
                return { order };
            } catch (err: any) {
                fastify.log.error(err);
                if (err.message.includes('Invalid QR') || err.message.includes('cannot be collected')) {
                    return reply.status(400).send({ error: err.message });
                }
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    // Get available time slots for scheduling
    fastify.get("/scheduling/time-slots", { schema: getAvailableTimeSlotsSchema }, async (request, reply) => {
        try {
            const { vendorId, eventId, slotDurationMinutes = 30 } = request.query as {
                vendorId: string;
                eventId: string;
                slotDurationMinutes?: number;
            };

            const result = await orderService.getAvailableTimeSlots(vendorId, eventId, slotDurationMinutes);
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Validate scheduled pickup time
    fastify.get("/scheduling/validate", { schema: validateScheduledPickupSchema }, async (request, reply) => {
        try {
            const { vendorId, eventId, scheduledPickupTime } = request.query as {
                vendorId: string;
                eventId: string;
                scheduledPickupTime: string;
            };

            const result = await orderService.validateScheduledPickupTime(vendorId, eventId, scheduledPickupTime);
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });
};

export default orderController;
