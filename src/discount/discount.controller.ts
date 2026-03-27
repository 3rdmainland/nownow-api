import { FastifyPluginAsync } from 'fastify';
import { DiscountService } from './discount.service.js';
import { CreateDiscountInput, UpdateDiscountInput } from './discount.types.js';
import { authenticate } from '../lib/auth.js';
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
        const discounts = await discountService.listVendorDiscounts(eventId, vendorId);
        return discounts;
    });

    // ==================== ORGANIZER ROUTES ====================

    // POST /discount/organizer/events/:eventId — Create organizer discount
    fastify.post('/organizer/events/:eventId', {
        schema: createOrganizerDiscountSchema,
    }, async (request, reply) => {
        const { eventId } = request.params as { eventId: string };
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
    }, async (request, reply) => {
        const { eventId } = request.params as { eventId: string };
        const discounts = await discountService.listOrganizerDiscounts(eventId);
        return discounts;
    });

    // ==================== SHARED ROUTES ====================

    // PATCH /discount/:id — Update a discount
    fastify.patch('/:id', {
        schema: updateDiscountSchema,
    }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as UpdateDiscountInput;
        const discount = await discountService.updateDiscount(id, body);
        return discount;
    });

    // DELETE /discount/:id — Delete a discount
    fastify.delete('/:id', {
        schema: deleteDiscountSchema,
    }, async (request, reply) => {
        const { id } = request.params as { id: string };
        await discountService.deleteDiscount(id);
        return { message: 'Discount deleted' };
    });
};

export default discountController;
