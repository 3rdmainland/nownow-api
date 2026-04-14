import { FastifyPluginAsync } from 'fastify';
import { DiscountService } from './discount.service.js';
import { CreateDiscountInput, UpdateDiscountInput } from './discount.types.js';
import { authenticate, authenticateOrganizer, authenticateVendorOrAdmin, assertVendorOwnership, assertOrganizerOwnsEvent } from '../lib/auth.js';
import { JwtPayload } from '../auth/auth.types.js';
import {
    createVendorDiscountSchema,
    listVendorDiscountsSchema,
    createOrganizerDiscountSchema,
    listOrganizerDiscountsSchema,
    updateDiscountSchema,
    deleteDiscountSchema,
} from './discount.schema.js';
import { requireFeature } from '../lib/feature-flags.js';

const discountController: FastifyPluginAsync = async (fastify) => {
    // Gate entire controller behind the 'discounts' feature flag
    fastify.addHook('preHandler', requireFeature('discounts'));
    const discountService = new DiscountService();

    // ==================== VENDOR ROUTES ====================

    // POST /discount/vendor/:vendorId/events/:eventId — Create vendor discount
    fastify.post('/vendor/:vendorId/events/:eventId', {
        schema: createVendorDiscountSchema,
        preHandler: [authenticate],
    }, async (request, reply) => {
        const { vendorId, eventId } = request.params as { vendorId: string; eventId: string };
        assertVendorOwnership(request, vendorId);
        const body = request.body as { scope: string; targetItemIds?: string[]; type: string; value: number };

        const input: CreateDiscountInput = {
            eventId,
            vendorId,
            scope: body.scope as CreateDiscountInput['scope'],
            targetItemIds: body.targetItemIds,
            type: body.type as CreateDiscountInput['type'],
            value: body.value,
            createdBy: 'VENDOR',
        };

        const discount = await discountService.createDiscount(input);
        return reply.status(201).send(discount);
    });

    // GET /discount/vendor/:vendorId/events/:eventId — List vendor discounts
    fastify.get('/vendor/:vendorId/events/:eventId', {
        schema: listVendorDiscountsSchema,
        preHandler: [authenticate],
    }, async (request, reply) => {
        const { vendorId, eventId } = request.params as { vendorId: string; eventId: string };
        assertVendorOwnership(request, vendorId);
        const discounts = await discountService.listVendorDiscounts(eventId, vendorId);
        return discounts;
    });

    // ==================== ORGANIZER ROUTES ====================

    // POST /discount/organizer/events/:eventId — Create organizer discount
    fastify.post('/organizer/events/:eventId', {
        schema: createOrganizerDiscountSchema,
        preHandler: [authenticateOrganizer],
    }, async (request, reply) => {
        const { eventId } = request.params as { eventId: string };
        await assertOrganizerOwnsEvent(request, eventId);
        const body = request.body as { type: string; value: number };

        const input: CreateDiscountInput = {
            eventId,
            scope: 'EVENT',
            type: body.type as CreateDiscountInput['type'],
            value: body.value,
            createdBy: 'ORGANIZER',
        };

        const discount = await discountService.createDiscount(input);
        return reply.status(201).send(discount);
    });

    // GET /discount/organizer/events/:eventId — List all event discounts
    fastify.get('/organizer/events/:eventId', {
        schema: listOrganizerDiscountsSchema,
        preHandler: [authenticateOrganizer],
    }, async (request, reply) => {
        const { eventId } = request.params as { eventId: string };
        await assertOrganizerOwnsEvent(request, eventId);
        const discounts = await discountService.listOrganizerDiscounts(eventId);
        return discounts;
    });

    // ==================== SHARED ROUTES ====================

    // PATCH /discount/:id — Update a discount (vendor or admin only, with ownership check)
    fastify.patch('/:id', {
        schema: updateDiscountSchema,
        preHandler: [authenticateVendorOrAdmin],
    }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const user = request.user as { vendorId?: string; role?: string };
        // Vendors can only update their own discounts
        if (user.role === 'vendor') {
            const existing = await discountService.getDiscountById(id);
            if (existing.vendorId !== user.vendorId) {
                return reply.status(403).send({ error: 'Access denied' });
            }
        }
        const body = request.body as UpdateDiscountInput;
        const discount = await discountService.updateDiscount(id, body);
        return discount;
    });

    // DELETE /discount/:id — Delete a discount (vendor or admin only, with ownership check)
    fastify.delete('/:id', {
        schema: deleteDiscountSchema,
        preHandler: [authenticateVendorOrAdmin],
    }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const user = request.user as { vendorId?: string; role?: string };
        // Vendors can only delete their own discounts
        if (user.role === 'vendor') {
            const existing = await discountService.getDiscountById(id);
            if (existing.vendorId !== user.vendorId) {
                return reply.status(403).send({ error: 'Access denied' });
            }
        }
        await discountService.deleteDiscount(id);
        return { message: 'Discount deleted' };
    });
};

export default discountController;
