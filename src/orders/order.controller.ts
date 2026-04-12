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
import { authenticate, authenticateCustomer, authenticateAdmin, authenticateVendor, authenticateVendorOrAdmin, optionalAuthenticateCustomer } from "../lib/auth.js";

const orderController: FastifyPluginAsync = async (fastify) => {
    const orderService = new OrderService();

    // Get all orders (admin only)
    fastify.get("/", { schema: getOrdersResponseSchema, preHandler: [authenticateVendorOrAdmin] }, async (request, reply) => {
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

    // Get recent orders (authenticated)
    fastify.get("/recent", { schema: getRecentOrdersSchema, preHandler: [authenticate] }, async (request, reply) => {
        try {
            const { limit = 10 } = request.query as { limit?: number };
            const orders = await orderService.getRecentOrders(limit);
            return { orders };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get time-series order statistics (authenticated)
    fastify.get("/stats/timeseries", { schema: getTimeSeriesStatsSchema, preHandler: [authenticate] }, async (request, reply) => {
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

    // Get order statistics (authenticated)
    fastify.get("/stats", { schema: getOrderStatsSchema, preHandler: [authenticate] }, async (request, reply) => {
        try {
            const { vendorId, eventId } = request.query as { vendorId?: string, eventId?: string };
            const stats = await orderService.getOrderStats(vendorId, eventId);
            return stats;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Search orders (authenticated)
    fastify.get("/search", { schema: searchOrdersSchema, preHandler: [authenticate] }, async (request, reply) => {
        try {
            const { q, eventId, page, pageSize } = request.query as { q: string; eventId?: string; page?: number; pageSize?: number };
            const result = await orderService.searchOrders(q, eventId, { page, pageSize });
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get orders by phone (authenticated — vendor/admin use)
    fastify.get("/phone", { schema: getOrdersByPhoneSchema, preHandler: [authenticate] }, async (request, reply) => {
        try {
            const { phone, eventId, page, pageSize } = request.query as { phone: string; eventId?: string; page?: number; pageSize?: number };
            const result = await orderService.getOrdersByPhone(phone, { page, pageSize }, eventId);
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get orders by status (authenticated)
    fastify.get("/status", { schema: getOrdersByStatusSchema, preHandler: [authenticate] }, async (request, reply) => {
        try {
            const { status, page, pageSize } = request.query as { status: string; page?: number; pageSize?: number };
            const result = await orderService.getOrdersByStatus(status, { page, pageSize });
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get orders by date range (authenticated)
    fastify.get("/date-range", { schema: getOrdersByDateRangeSchema, preHandler: [authenticate] }, async (request, reply) => {
        try {
            const { startDate, endDate, page, pageSize } = request.query as { startDate: string; endDate: string; page?: number; pageSize?: number };
            const result = await orderService.getOrdersByDateRange(startDate, endDate, { page, pageSize });
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get orders by vendor (auth required — vendor can only access their own orders)
    fastify.get("/vendor/:vendorId", { schema: getOrdersByVendorSchema, preHandler: [authenticate] }, async (request, reply) => {
        try {
            const { vendorId } = request.params as { vendorId: string };
            const user = request.user as { vendorId?: string; role?: string };

            // Admins can access any vendor's orders; vendors can only access their own
            if (user.role !== 'admin' && user.vendorId !== vendorId) {
                return reply.status(403).send({ error: "Access denied" });
            }

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
    fastify.get("/event/:eventId", { schema: getOrdersByEventSchema, preHandler: [authenticate] }, async (request, reply) => {
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

    // Get order by ID (authenticated)
    fastify.get<{ Params: { id: string } }>("/:id", { schema: getOrderByIdResponseSchema, preHandler: [authenticate] }, async (request, reply) => {
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

    // Create new order (rate limited)
    fastify.post("/", { schema: createOrderSchema, preHandler: [optionalAuthenticateCustomer], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
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

    // Update order status (vendor or admin — vendor must own the order)
    fastify.patch<{ Params: { id: string } }>("/:id/status", { schema: updateOrderStatusSchema, preHandler: [authenticateVendorOrAdmin] }, async (request, reply) => {
        try {
            const { id } = request.params;
            const { status } = request.body as { status: OrderStatus };
            const user = request.user as { vendorId?: string; role?: string };

            // Vendor can only update their own orders
            if (user.role === 'vendor' && user.vendorId) {
                const existing = await orderService.getOrderById(id);
                if (existing && existing.vendor_id !== user.vendorId) {
                    return reply.status(403).send({ error: 'You can only update your own orders' });
                }
            }

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
        { schema: refundOrderSchema, preHandler: [authenticateVendorOrAdmin] },
        async (request, reply) => {
            try {
                const { id } = request.params;
                const { type, amount, reason } = request.body as { type: 'full' | 'partial'; amount?: number; reason: string };
                const user = request.user as { email?: string; sub?: string; vendorId?: string; role?: string };
                const refundedBy = user.email || user.sub || 'unknown';

                // Vendors can only refund their own orders
                if (user.role === 'vendor' && user.vendorId) {
                    const orderData = await orderService.getOrderById(id);
                    if (orderData && orderData.vendor_id !== user.vendorId) {
                        return reply.status(403).send({ error: 'You can only refund your own orders' });
                    }
                }

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

    // Delete order (admin only)
    fastify.delete<{ Params: { id: string } }>("/:id", { schema: deleteOrderSchema, preHandler: [authenticateAdmin] }, async (request, reply) => {
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

    fastify.post<{ Body: { qr_code: string } }>(
        "/collect",
        {
            schema: confirmCollectionSchema,
            preHandler: [authenticate],
            config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        },
        async (request, reply) => {
            try {
                const user = request.user as { vendorId?: string; role?: string };
                if (!user?.vendorId) {
                    return reply.status(403).send({ error: "Vendor identity required" });
                }

                const order = await orderService.confirmCollectionByQR(
                    request.body.qr_code,
                    user.vendorId
                );
                return { order };
            } catch (err: any) {
                fastify.log.error(err);
                const statusCode = err.statusCode;
                if (statusCode === 400 || statusCode === 403 || statusCode === 404) {
                    return reply.status(statusCode).send({ error: err.message });
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
