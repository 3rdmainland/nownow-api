import { FastifyPluginAsync } from 'fastify';
import { authenticateAdmin } from '../lib/auth.js';
import { AdminJwtPayload } from '../admin-auth/admin-auth.types.js';
import { SupportService } from './support.service.js';
import {
  CreateTicketPayload,
  UpdateTicketPayload,
  AddMessagePayload,
  TicketListParams,
} from './support.types.js';
import {
  listTicketsSchema,
  getTicketSchema,
  createTicketSchema,
  updateTicketSchema,
  addMessageSchema,
  resolveTicketSchema,
  closeTicketSchema,
  supportStatsSchema,
} from './support.schema.js';

const supportController: FastifyPluginAsync = async (fastify) => {
  const supportService = new SupportService();

  // All routes require admin auth
  fastify.addHook('preHandler', authenticateAdmin);

  // GET /support/tickets
  fastify.get('/tickets', { schema: listTicketsSchema }, async (request) => {
    const params = request.query as TicketListParams;
    return supportService.listTickets(params);
  });

  // GET /support/tickets/:id
  fastify.get('/tickets/:id', { schema: getTicketSchema }, async (request) => {
    const { id } = request.params as { id: string };
    return supportService.getTicketById(id);
  });

  // POST /support/tickets
  fastify.post('/tickets', { schema: createTicketSchema }, async (request, reply) => {
    const payload = request.body as CreateTicketPayload;
    const { userId } = request.user as AdminJwtPayload;
    const ticket = await supportService.createTicket(payload, userId);
    return reply.status(201).send(ticket);
  });

  // PATCH /support/tickets/:id
  fastify.patch('/tickets/:id', { schema: updateTicketSchema }, async (request) => {
    const { id } = request.params as { id: string };
    const payload = request.body as UpdateTicketPayload;
    const { userId } = request.user as AdminJwtPayload;
    return supportService.updateTicket(id, payload, userId);
  });

  // POST /support/tickets/:id/messages
  fastify.post('/tickets/:id/messages', { schema: addMessageSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const payload = request.body as AddMessagePayload;
    const { userId, email } = request.user as AdminJwtPayload;
    const message = await supportService.addMessage(id, payload, 'ADMIN', userId, email);
    return reply.status(201).send(message);
  });

  // POST /support/tickets/:id/resolve
  fastify.post('/tickets/:id/resolve', { schema: resolveTicketSchema }, async (request) => {
    const { id } = request.params as { id: string };
    const { message } = request.body as { message: string };
    const { userId } = request.user as AdminJwtPayload;
    return supportService.resolveTicket(id, message, userId);
  });

  // POST /support/tickets/:id/close
  fastify.post('/tickets/:id/close', { schema: closeTicketSchema }, async (request) => {
    const { id } = request.params as { id: string };
    const { userId } = request.user as AdminJwtPayload;
    return supportService.closeTicket(id, userId);
  });

  // GET /support/stats
  fastify.get('/stats', { schema: supportStatsSchema }, async () => {
    return supportService.getStats();
  });
};

export default supportController;
