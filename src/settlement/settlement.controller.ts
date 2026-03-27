import { FastifyPluginAsync } from 'fastify';
import { authenticateAdmin } from '../lib/auth.js';
import { SettlementService } from './settlement.service.js';
import { AdminJwtPayload } from '../admin-auth/admin-auth.types.js';
import {
  createBatchSchema,
  listBatchesSchema,
  getBatchSchema,
  processBatchSchema,
  retryBatchSchema,
  summarySchema,
  vendorPayoutsSchema,
  upsertBankDetailsSchema,
  getBankDetailsSchema,
} from './settlement.schema.js';
import { CreateBatchPayload, UpsertBankDetailsPayload } from './settlement.types.js';

const settlementController: FastifyPluginAsync = async (fastify) => {
  const service = new SettlementService();

  // All routes require admin auth
  fastify.addHook('preHandler', authenticateAdmin);

  // POST /settlement/batches
  fastify.post('/batches', { schema: createBatchSchema }, async (request) => {
    const payload = request.body as CreateBatchPayload;
    const { userId } = request.user as AdminJwtPayload;
    return service.createBatch(payload, userId);
  });

  // GET /settlement/batches
  fastify.get('/batches', { schema: listBatchesSchema }, async (request) => {
    const { status, page, limit } = request.query as { status?: string; page?: number; limit?: number };
    const result = await service.listBatches({ status, page, limit });
    return { ...result, page: page || 1, limit: limit || 20 };
  });

  // GET /settlement/batches/:id
  fastify.get('/batches/:id', { schema: getBatchSchema }, async (request) => {
    const { id } = request.params as { id: string };
    return service.getBatch(id);
  });

  // POST /settlement/batches/:id/process
  fastify.post('/batches/:id/process', { schema: processBatchSchema }, async (request) => {
    const { id } = request.params as { id: string };
    return service.processBatch(id);
  });

  // POST /settlement/batches/:id/retry
  fastify.post('/batches/:id/retry', { schema: retryBatchSchema }, async (request) => {
    const { id } = request.params as { id: string };
    return service.retryBatch(id);
  });

  // GET /settlement/summary
  fastify.get('/summary', { schema: summarySchema }, async () => {
    return service.getSummary();
  });

  // GET /settlement/vendors/:vendorId/payouts
  fastify.get('/vendors/:vendorId/payouts', { schema: vendorPayoutsSchema }, async (request) => {
    const { vendorId } = request.params as { vendorId: string };
    const { page, limit } = request.query as { page?: number; limit?: number };
    return service.getVendorPayouts(vendorId, { page, limit });
  });

  // PUT /settlement/vendors/:vendorId/bank-details
  fastify.put('/vendors/:vendorId/bank-details', { schema: upsertBankDetailsSchema }, async (request) => {
    const { vendorId } = request.params as { vendorId: string };
    const payload = request.body as UpsertBankDetailsPayload;
    return service.upsertBankDetails(vendorId, payload);
  });

  // GET /settlement/vendors/:vendorId/bank-details
  fastify.get('/vendors/:vendorId/bank-details', { schema: getBankDetailsSchema }, async (request) => {
    const { vendorId } = request.params as { vendorId: string };
    return service.getBankDetails(vendorId);
  });
};

export default settlementController;
