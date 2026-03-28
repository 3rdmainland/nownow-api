import { FastifyPluginAsync } from 'fastify';
import { authenticateOrganizer } from '../lib/auth.js';
import { OrganizerService } from './organizer.service.js';
import type { CreateAgreementPayload, UpdateAgreementPayload } from './organizer.types.js';
import {
  settlementOverviewSchema,
  eventVendorBreakdownSchema,
  platformTermsSchema,
  listAgreementsSchema,
  getAgreementSchema,
  createAgreementSchema,
  updateAgreementSchema,
  deleteAgreementSchema,
} from './organizer.schema.js';

const organizerController: FastifyPluginAsync = async (fastify) => {
  const service = new OrganizerService();

  function getUserId(request: any): string {
    return (request.user as { userId: string }).userId;
  }

  // GET /organizer/settlements/overview
  fastify.get(
    '/settlements/overview',
    { schema: settlementOverviewSchema, preHandler: [authenticateOrganizer] },
    async (request) => {
      return service.getSettlementOverview(getUserId(request));
    },
  );

  // GET /organizer/settlements/events/:eventId/vendors
  fastify.get(
    '/settlements/events/:eventId/vendors',
    { schema: eventVendorBreakdownSchema, preHandler: [authenticateOrganizer] },
    async (request) => {
      const { eventId } = request.params as { eventId: string };
      return service.getEventVendorBreakdown(getUserId(request), eventId);
    },
  );

  // GET /organizer/platform-terms
  fastify.get(
    '/platform-terms',
    { schema: platformTermsSchema, preHandler: [authenticateOrganizer] },
    async () => {
      return service.getPlatformTerms();
    },
  );

  // GET /organizer/agreements
  fastify.get(
    '/agreements',
    { schema: listAgreementsSchema, preHandler: [authenticateOrganizer] },
    async (request) => {
      const { eventId, status } = request.query as { eventId?: string; status?: string };
      return service.listAgreements(getUserId(request), { eventId, status });
    },
  );

  // GET /organizer/agreements/:id
  fastify.get(
    '/agreements/:id',
    { schema: getAgreementSchema, preHandler: [authenticateOrganizer] },
    async (request) => {
      const { id } = request.params as { id: string };
      return service.getAgreement(getUserId(request), id);
    },
  );

  // POST /organizer/agreements
  fastify.post(
    '/agreements',
    { schema: createAgreementSchema, preHandler: [authenticateOrganizer] },
    async (request) => {
      const payload = request.body as CreateAgreementPayload;
      return service.createAgreement(getUserId(request), payload);
    },
  );

  // PATCH /organizer/agreements/:id
  fastify.patch(
    '/agreements/:id',
    { schema: updateAgreementSchema, preHandler: [authenticateOrganizer] },
    async (request) => {
      const { id } = request.params as { id: string };
      const payload = request.body as UpdateAgreementPayload;
      return service.updateAgreement(getUserId(request), id, payload);
    },
  );

  // DELETE /organizer/agreements/:id
  fastify.delete(
    '/agreements/:id',
    { schema: deleteAgreementSchema, preHandler: [authenticateOrganizer] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await service.deleteAgreement(getUserId(request), id);
      return reply.status(204).send();
    },
  );
};

export default organizerController;
