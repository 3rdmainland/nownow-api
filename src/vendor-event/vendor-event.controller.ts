import { FastifyPluginAsync } from 'fastify';
import { requireFeature } from '../lib/feature-flags.js';
import { VendorEventService } from './vendor-event.service.js';
import {
  createVendorEventSchema,
  listVendorEventsSchema,
  getVendorEventSchema,
  updateVendorEventSchema,
  deleteVendorEventSchema,
  getDirectQRSchema,
  updateDirectQRMenuSchema,
  getVendorEventQRSchema,
} from './vendor-event.schema.js';

const vendorEventController: FastifyPluginAsync = async (fastify) => {
  const service = new VendorEventService();

  // Helper: extract vendorId from JWT
  async function getVendorId(request: any, reply: any): Promise<string> {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Authentication required' });
      throw new Error('Unauthorized');
    }
    const user = request.user as { vendorId?: string; role?: string };
    if (user?.role !== 'vendor' || !user.vendorId) {
      reply.status(401).send({ error: 'Vendor authentication required' });
      throw new Error('Unauthorized');
    }
    return user.vendorId;
  }

  // POST /vendor-events — create a vendor lite event (feature-flagged)
  fastify.post('/', { schema: createVendorEventSchema, preHandler: [requireFeature('vendor_events')] }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const payload = request.body as { name: string; startDate: string; endDate: string; menuTemplateId?: string; allowPayAtStall?: boolean };
      const vendorEvent = await service.createVendorEvent(vendorId, payload);
      return reply.status(201).send({ vendorEvent });
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 403) return reply.status(403).send({ error: err.message });
      if (err.statusCode === 400 || err.name === 'ValidationError') return reply.status(400).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /vendor-events — list vendor's own events
  fastify.get('/', { schema: listVendorEventsSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const vendorEvents = await service.listVendorEvents(vendorId);
      return { vendorEvents };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /vendor-events/:id — get a specific vendor event
  fastify.get<{ Params: { id: string } }>('/:id', { schema: getVendorEventSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const vendorEvent = await service.getVendorEvent(request.params.id, vendorId);
      return { vendorEvent };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /vendor-events/:id — update event name/dates
  fastify.patch<{ Params: { id: string } }>('/:id', { schema: updateVendorEventSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const updates = request.body as { name?: string; startDate?: string; endDate?: string };
      const vendorEvent = await service.updateVendorEvent(request.params.id, vendorId, updates);
      return { vendorEvent };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // DELETE /vendor-events/:id — deactivate event
  fastify.delete<{ Params: { id: string } }>('/:id', { schema: deleteVendorEventSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      await service.deactivateVendorEvent(request.params.id, vendorId);
      return reply.status(204).send();
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /vendor-events/direct-qr — generate or get permanent direct QR
  fastify.post('/direct-qr', { schema: getDirectQRSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const vendorEvent = await service.getOrCreateDirectQR(vendorId);
      return { vendorEvent };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 403) return reply.status(403).send({ error: err.message });
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });

  // PATCH /vendor-events/direct-qr/menu — swap active menu template
  fastify.patch('/direct-qr/menu', { schema: updateDirectQRMenuSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const { menuTemplateId } = request.body as { menuTemplateId: string | null };
      const vendorEvent = await service.updateDirectQRMenu(vendorId, menuTemplateId);
      return { vendorEvent };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /vendor-events/orders — orders from vendor-created events only (lite-focused)
  fastify.get('/orders', async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const { status, page, limit } = request.query as { status?: string; page?: string; limit?: string };
      const result = await service.getVendorEventOrders(vendorId, {
        status,
        page: page ? parseInt(page) : undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
      return result;
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /vendor-events/:id/qr — re-download QR
  fastify.get<{ Params: { id: string } }>('/:id/qr', { schema: getVendorEventQRSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      return await service.getVendorEventQR(request.params.id, vendorId);
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
};

export default vendorEventController;
