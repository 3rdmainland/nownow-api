import { FastifyPluginAsync } from "fastify";
import {
    getVendorsSchema,
    getVendorByIdSchema,
    createVendorSchema,
    updateVendorSchema,
    deleteVendorSchema,
    toggleVendorStatusSchema,
    pauseVendorSchema,
    getVendorsByCategorySchema,
    getVendorsWithItemsInCategorySchema,
    searchVendorsSchema,
    getVendorStatsSchema,
    getVendorsByEventSchema,
} from "./vendor.schema";
import { VendorService } from "./vendor.service";

const vendorController: FastifyPluginAsync = async (fastify) => {
    const vendorService = new VendorService();

    // Get all vendors
    fastify.get("/", { schema: getVendorsSchema }, async (request, reply) => {
        try {
            const vendors = await vendorService.getAllVendors();
            return { vendors };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Search vendors (optionally by event)
    fastify.get("/search", { schema: searchVendorsSchema }, async (request, reply) => {
        try {
            const { q, eventId } = request.query as { q: string; eventId?: string };
            const vendors = await vendorService.searchVendors(q, eventId);
            return { vendors };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // List vendors assigned to an event (paginated, with menu)
    fastify.get("/event/:eventId", { schema: getVendorsByEventSchema }, async (request, reply) => {
        try {
            const { eventId } = request.params as { eventId: string };
            const { page, pageSize, categoryId } = request.query as { page?: number; pageSize?: number; categoryId?: string };
            const result = await vendorService.getVendorsByEvent(eventId, { page, pageSize, categoryId });
            return result;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get vendors by category
    fastify.get("/category", { schema: getVendorsByCategorySchema }, async (request, reply) => {
        try {
            const { categoryId } = request.query as { categoryId: string };
            const vendors = await vendorService.getVendorsByCategory(categoryId);
            return { vendors };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get vendors that have items in a given menu category, optionally scoped to an event
    fastify.get("/category/items", { schema: getVendorsWithItemsInCategorySchema }, async (request, reply) => {
        try {
            const { categoryId, eventCode } = request.query as { categoryId: string; eventCode?: string };
            const vendors = await vendorService.getVendorsWithItemsInCategory(categoryId, eventCode);
            return { vendors };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get vendor by ID
    fastify.get<{ Params: { id: string } }>("/:id", { schema: getVendorByIdSchema }, async (request, reply) => {
        try {
            const vendor = await vendorService.getVendorById(request.params.id);
            if (!vendor) {
                return reply.status(404).send({ error: "Vendor not found" });
            }
            return { vendor };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Get vendor statistics
    fastify.get<{ Params: { id: string } }>("/:id/stats", { schema: getVendorStatsSchema }, async (request, reply) => {
        try {
            const stats = await vendorService.getVendorStats(request.params.id);
            return stats;
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Create vendor
    fastify.post("/", { schema: createVendorSchema }, async (request, reply) => {
        try {
            const vendorData = request.body as any;
            const vendor = await vendorService.createVendor(vendorData);
            return reply.status(201).send({ vendor });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Update vendor
    fastify.put<{ Params: { id: string } }>("/:id", { schema: updateVendorSchema }, async (request, reply) => {
        try {
            const updates = request.body as any;
            const vendor = await vendorService.updateVendor(request.params.id, updates);
            return { vendor };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Toggle vendor status
    fastify.patch<{ Params: { id: string } }>("/:id/status", { schema: toggleVendorStatusSchema }, async (request, reply) => {
        try {
            const { isActive } = request.body as { isActive: boolean };
            const vendor = await vendorService.toggleVendorStatus(request.params.id, isActive);
            return { vendor };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Pause/unpause vendor
    fastify.patch<{ Params: { id: string } }>("/:id/pause", { schema: pauseVendorSchema }, async (request, reply) => {
        try {
            const { isPaused } = request.body as { isPaused: boolean };
            const vendor = await vendorService.pauseVendor(request.params.id, isPaused);
            return { vendor };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    // Delete vendor
    fastify.delete<{ Params: { id: string } }>("/:id", { schema: deleteVendorSchema }, async (request, reply) => {
        try {
            await vendorService.deleteVendor(request.params.id);
            return reply.status(204).send();
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

};

export default vendorController;
