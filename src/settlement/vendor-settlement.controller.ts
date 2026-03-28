import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { SettlementService } from './settlement.service.js';
import { OrganizerService } from '../organizer/organizer.service.js';
import { UpsertBankDetailsPayload } from './settlement.types.js';
import {
  vendorGetBankDetailsSchema,
  vendorUpsertBankDetailsSchema,
  vendorPayoutsSchema,
  vendorSummarySchema,
  vendorAgreementsSchema,
  vendorAcceptAgreementSchema,
} from './vendor-settlement.schema.js';

const vendorSettlementController: FastifyPluginAsync = async (fastify) => {
  const service = new SettlementService();
  const organizerService = new OrganizerService();

  // Helper: assert vendor owns the resource (or is admin)
  function assertOwnership(request: any, reply: any, vendorId: string) {
    const user = request.user as { vendorId?: string; role?: string };
    if (user.role !== 'admin' && user.vendorId !== vendorId) {
      reply.status(403).send({ error: 'Access denied' });
      return false;
    }
    return true;
  }

  // GET /vendor/:vendorId/settlement/bank-details
  fastify.get(
    '/:vendorId/settlement/bank-details',
    { schema: vendorGetBankDetailsSchema, preHandler: [authenticate] },
    async (request, reply) => {
      const { vendorId } = request.params as { vendorId: string };
      if (!assertOwnership(request, reply, vendorId)) return;
      return service.getBankDetails(vendorId);
    },
  );

  // PUT /vendor/:vendorId/settlement/bank-details
  fastify.put(
    '/:vendorId/settlement/bank-details',
    { schema: vendorUpsertBankDetailsSchema, preHandler: [authenticate] },
    async (request, reply) => {
      const { vendorId } = request.params as { vendorId: string };
      if (!assertOwnership(request, reply, vendorId)) return;
      const payload = request.body as UpsertBankDetailsPayload;
      return service.upsertBankDetails(vendorId, payload);
    },
  );

  // GET /vendor/:vendorId/settlement/payouts
  fastify.get(
    '/:vendorId/settlement/payouts',
    { schema: vendorPayoutsSchema, preHandler: [authenticate] },
    async (request, reply) => {
      const { vendorId } = request.params as { vendorId: string };
      if (!assertOwnership(request, reply, vendorId)) return;
      const { page, limit } = request.query as { page?: number; limit?: number };
      return service.getVendorPayouts(vendorId, { page, limit });
    },
  );

  // GET /vendor/:vendorId/settlement/summary
  fastify.get(
    '/:vendorId/settlement/summary',
    { schema: vendorSummarySchema, preHandler: [authenticate] },
    async (request, reply) => {
      const { vendorId } = request.params as { vendorId: string };
      if (!assertOwnership(request, reply, vendorId)) return;
      return service.getVendorSettlementSummary(vendorId);
    },
  );

  // GET /vendor/:vendorId/agreements
  fastify.get(
    '/:vendorId/agreements',
    { schema: vendorAgreementsSchema, preHandler: [authenticate] },
    async (request, reply) => {
      const { vendorId } = request.params as { vendorId: string };
      if (!assertOwnership(request, reply, vendorId)) return;
      const { status } = request.query as { status?: string };
      return organizerService.getVendorAgreements(vendorId, { status });
    },
  );

  // POST /vendor/:vendorId/agreements/:id/accept
  fastify.post(
    '/:vendorId/agreements/:id/accept',
    { schema: vendorAcceptAgreementSchema, preHandler: [authenticate] },
    async (request, reply) => {
      const { vendorId, id } = request.params as { vendorId: string; id: string };
      if (!assertOwnership(request, reply, vendorId)) return;
      return organizerService.acceptAgreement(vendorId, id, { ip: request.ip });
    },
  );
};

export default vendorSettlementController;
