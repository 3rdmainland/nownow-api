import { FastifyPluginAsync } from 'fastify';
import { StallService } from './stall.service.js';
import {
  createStallSchema,
  listStallsSchema,
  getStallSchema,
  updateStallSchema,
  deleteStallSchema,
  getStallQRSchema,
  listInvitedEventsSchema,
} from './stall.schema.js';

const stallController: FastifyPluginAsync = async (fastify) => {
  const service = new StallService();

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

  // GET /stalls/available-events — list organizer events the vendor has been invited to
  fastify.get('/available-events', { schema: listInvitedEventsSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const events = await service.listAvailableEvents(vendorId);
      return { events };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /stalls — create a stall at an organizer event
  fastify.post('/', { schema: createStallSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const body = request.body as { eventId: string; menuTemplateId?: string; allowPayAtStall?: boolean; boothInfo?: string };
      const stall = await service.createStall(vendorId, body);
      return reply.status(201).send({ stall });
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 403) return reply.status(403).send({ error: err.message });
      if (err.statusCode === 400 || err.name === 'ValidationError') return reply.status(400).send({ error: err.message });
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      if (err.statusCode === 409) return reply.status(409).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /stalls — list vendor's stalls
  fastify.get('/', { schema: listStallsSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const stalls = await service.listStalls(vendorId);
      return { stalls };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /stalls/:id — get a specific stall
  fastify.get<{ Params: { id: string } }>('/:id', { schema: getStallSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const stall = await service.getStall(request.params.id, vendorId);
      return { stall };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /stalls/:id — update a stall
  fastify.patch<{ Params: { id: string } }>('/:id', { schema: updateStallSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const body = request.body as { menuTemplateId?: string | null; boothInfo?: string | null; allowPayAtStall?: boolean };
      const stall = await service.updateStall(request.params.id, vendorId, body);
      return { stall };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // DELETE /stalls/:id — deactivate a stall
  fastify.delete<{ Params: { id: string } }>('/:id', { schema: deleteStallSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      await service.deactivateStall(request.params.id, vendorId);
      return reply.status(204).send();
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /stalls/:id/qr — get QR code for a stall
  fastify.get<{ Params: { id: string } }>('/:id/qr', { schema: getStallQRSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const { qrCode, qrImage } = await service.getStallQR(request.params.id, vendorId);
      return { qrCode, qrImage };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
};

export default stallController;
