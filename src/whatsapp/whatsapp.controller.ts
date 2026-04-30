import { FastifyPluginAsync } from "fastify";
import { getWhatsappService } from "./whatsapp.service";
import {
    sendWhatsAppMessageSchema,
    orderPlacedSchema,
    orderReadySchema,
    SendWhatsAppMessageBody,
    OrderPlacedBody,
    OrderReadyBody
} from "./whatsapp.schema";

import { authenticateAdmin } from "../lib/auth.js";
import { requireFeature } from "../lib/feature-flags.js";

const whatsappController: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireFeature('whatsapp'));
    const whatsappService = getWhatsappService();

    fastify.post<{ Body: SendWhatsAppMessageBody }>(
        "/test",
        { schema: sendWhatsAppMessageSchema, preHandler: [authenticateAdmin] },
        async (req, reply) => {
            try {
                const { to } = req.body;
                await whatsappService.sendWhatsAppMessage(to);
                return reply.status(201).send({ success: true });
            } catch (err) {
                req.log.error({ err }, "Failed to send WhatsApp message");
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    fastify.post<{ Body: OrderPlacedBody }>(
        "/order-placed",
        { schema: orderPlacedSchema, preHandler: [authenticateAdmin] },
        async (req, reply) => {
            try {
                const { to, orderId, total, prepTimeMinutes, qrImageUrl } = req.body;
                await whatsappService.sendOrderPlacedTemplate(to, {
                    orderId,
                    total,
                    prepTimeMinutes,
                    qrImageUrl: qrImageUrl ?? undefined
                });
                return reply.status(201).send({ success: true });
            } catch (err: unknown) {
                req.log.error({ err }, "Failed to send order template");
                const message = err instanceof Error ? err.message : "Internal server error";
                return reply.status(500).send({ error: message });
            }
        }
    );

    fastify.post<{ Body: OrderReadyBody }>(
        "/order-ready",
        { schema: orderReadySchema, preHandler: [authenticateAdmin] },
        async (req, reply) => {
            try {
                const { to, orderId, vendorName } = req.body;
                await whatsappService.sendOrderReadyTemplate(to, {
                    orderId,
                    vendorName
                });
                return reply.status(201).send({ success: true });
            } catch (err: unknown) {
                req.log.error({ err }, "Failed to send order ready notification");
                const message = err instanceof Error ? err.message : "Internal server error";
                return reply.status(500).send({ error: message });
            }
        }
    );
};

export default whatsappController;
