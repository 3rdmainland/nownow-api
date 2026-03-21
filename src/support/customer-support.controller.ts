import { FastifyPluginAsync } from 'fastify';
import { authenticateCustomer } from '../lib/auth.js';
import { CustomerJwtPayload } from '../customer-auth/customer-auth.types.js';
import { SupportService } from './support.service.js';
import { CreateTicketPayload } from './support.types.js';
import {
  customerListTicketsSchema,
  customerGetTicketSchema,
  customerCreateTicketSchema,
  customerAddMessageSchema,
} from './customer-support.schema.js';

const customerSupportController: FastifyPluginAsync = async (fastify) => {
  const supportService = new SupportService();

  fastify.addHook('preHandler', authenticateCustomer);

  // GET /customer/support/tickets
  fastify.get('/tickets', { schema: customerListTicketsSchema }, async (request) => {
    const { phone } = request.user as CustomerJwtPayload;
    return supportService.listTicketsByPhone(phone);
  });

  // GET /customer/support/tickets/:id
  fastify.get('/tickets/:id', { schema: customerGetTicketSchema }, async (request) => {
    const { id } = request.params as { id: string };
    const { phone } = request.user as CustomerJwtPayload;
    return supportService.getTicketByIdForCustomer(id, phone);
  });

  // POST /customer/support/tickets
  fastify.post('/tickets', { schema: customerCreateTicketSchema }, async (request, reply) => {
    const payload = request.body as CreateTicketPayload;
    const { customerId, phone } = request.user as CustomerJwtPayload;
    const ticket = await supportService.createCustomerTicket(payload, customerId, phone);
    return reply.status(201).send(ticket);
  });

  // POST /customer/support/tickets/:id/messages
  fastify.post('/tickets/:id/messages', { schema: customerAddMessageSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { message } = request.body as { message: string };
    const { phone } = request.user as CustomerJwtPayload;
    const msg = await supportService.addCustomerMessage(id, phone, message);
    return reply.status(201).send(msg);
  });
};

export default customerSupportController;
