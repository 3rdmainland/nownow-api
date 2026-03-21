import { FastifyPluginAsync } from 'fastify';
import { authenticateCustomer } from '../lib/auth.js';
import { CustomerJwtPayload } from '../customer-auth/customer-auth.types.js';
import { SupportService } from './support.service.js';
import { CreateTicketPayload, CreateGuestTicketPayload } from './support.types.js';
import {
  customerListTicketsSchema,
  customerGetTicketSchema,
  customerCreateTicketSchema,
  customerAddMessageSchema,
  customerCreateGuestTicketSchema,
} from './customer-support.schema.js';

const customerSupportController: FastifyPluginAsync = async (fastify) => {
  const supportService = new SupportService();

  // ── Guest endpoint (no auth) ──

  // POST /customer/support/guest-ticket
  fastify.post('/guest-ticket', {
    schema: customerCreateGuestTicketSchema,
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 hour',
      },
    },
  }, async (request, reply) => {
    const payload = request.body as CreateGuestTicketPayload;
    const ticket = await supportService.createGuestTicket(payload);
    return reply.status(201).send(ticket);
  });

  // ── Authenticated endpoints ──

  // GET /customer/support/tickets
  fastify.get('/tickets', {
    schema: customerListTicketsSchema,
    preHandler: authenticateCustomer,
  }, async (request) => {
    const { phone } = request.user as CustomerJwtPayload;
    return supportService.listTicketsByPhone(phone);
  });

  // GET /customer/support/tickets/:id
  fastify.get('/tickets/:id', {
    schema: customerGetTicketSchema,
    preHandler: authenticateCustomer,
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { phone } = request.user as CustomerJwtPayload;
    return supportService.getTicketByIdForCustomer(id, phone);
  });

  // POST /customer/support/tickets
  fastify.post('/tickets', {
    schema: customerCreateTicketSchema,
    preHandler: authenticateCustomer,
  }, async (request, reply) => {
    const payload = request.body as CreateTicketPayload;
    const { customerId, phone } = request.user as CustomerJwtPayload;
    const ticket = await supportService.createCustomerTicket(payload, customerId, phone);
    return reply.status(201).send(ticket);
  });

  // POST /customer/support/tickets/:id/messages
  fastify.post('/tickets/:id/messages', {
    schema: customerAddMessageSchema,
    preHandler: authenticateCustomer,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { message } = request.body as { message: string };
    const { phone } = request.user as CustomerJwtPayload;
    const msg = await supportService.addCustomerMessage(id, phone, message);
    return reply.status(201).send(msg);
  });
};

export default customerSupportController;
