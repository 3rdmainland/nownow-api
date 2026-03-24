import { FastifyPluginAsync } from 'fastify';
import { authenticateAdmin, optionalAuthenticateCustomer } from '../lib/auth.js';
import { legalService } from './legal.service.js';
import {
  createDocumentSchema,
  updateDocumentSchema,
  getDocumentSchema,
  getHistorySchema,
  publishSchema,
  acceptDocumentSchema,
  getAcceptancesSchema,
} from './legal.schema.js';
import type { CreateDocumentDto, UpdateDocumentDto } from './legal.types.js';

const legalController: FastifyPluginAsync = async (fastify) => {
  // ── Static routes MUST be registered before parameterized routes ────

  /** GET /legal — List all documents (admin) */
  fastify.get(
    '/',
    { preHandler: [authenticateAdmin] },
    async (_request, reply) => {
      try {
        const docs = await legalService.listAll();
        return { documents: docs };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  /** GET /legal/acceptances — List acceptances (admin) */
  fastify.get<{ Querystring: { slug?: string; page?: string; limit?: string } }>(
    '/acceptances',
    { schema: getAcceptancesSchema, preHandler: [authenticateAdmin] },
    async (request, reply) => {
      try {
        const { slug, page, limit } = request.query;
        const result = await legalService.getAcceptances({
          slug,
          page: page ? parseInt(page, 10) : undefined,
          limit: limit ? parseInt(limit, 10) : undefined,
        });
        return result;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  /** GET /legal/acceptance-stats — Acceptance statistics (admin) */
  fastify.get(
    '/acceptance-stats',
    { preHandler: [authenticateAdmin] },
    async (_request, reply) => {
      try {
        const stats = await legalService.getAcceptanceStats();
        return { stats };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  // ── Parameterized routes ────────────────────────────────────────────

  /** GET /legal/:slug — Get the currently published document (public) */
  fastify.get<{ Params: { slug: string } }>(
    '/:slug',
    { schema: getDocumentSchema },
    async (request, reply) => {
      try {
        const doc = await legalService.getPublished(request.params.slug);
        return doc;
      } catch (err: any) {
        if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  /** GET /legal/:slug/history — Get all versions (admin) */
  fastify.get<{ Params: { slug: string } }>(
    '/:slug/history',
    { schema: getHistorySchema, preHandler: [authenticateAdmin] },
    async (request, reply) => {
      try {
        const history = await legalService.getHistory(request.params.slug);
        return { versions: history };
      } catch (err: any) {
        if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  /** POST /legal/:slug — Create a new version (admin) */
  fastify.post<{ Params: { slug: string }; Body: CreateDocumentDto }>(
    '/:slug',
    { schema: createDocumentSchema, preHandler: [authenticateAdmin] },
    async (request, reply) => {
      try {
        const admin = request.user as { userId?: string };
        const adminId = admin.userId ?? null;
        const doc = await legalService.createVersion(request.params.slug, request.body, adminId);
        return reply.status(201).send(doc);
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  /** POST /legal/:slug/accept — Record acceptance (public, optional auth) */
  fastify.post<{ Params: { slug: string }; Body: { customer_phone?: string } }>(
    '/:slug/accept',
    { schema: acceptDocumentSchema, preHandler: [optionalAuthenticateCustomer] },
    async (request, reply) => {
      try {
        const user = request.user as { customerId?: string; phone?: string } | undefined;
        const customerId = user?.customerId ?? null;
        const customerPhone = request.body?.customer_phone ?? user?.phone ?? null;
        const ipAddress = request.ip;
        const userAgent = request.headers['user-agent'] ?? null;

        const acceptance = await legalService.recordAcceptance(
          request.params.slug,
          customerId,
          customerPhone,
          ipAddress,
          userAgent,
        );
        return acceptance;
      } catch (err: any) {
        if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  /** POST /legal/:slug/publish — Publish a version (admin) */
  fastify.post<{ Params: { slug: string }; Body: { version?: number } }>(
    '/:slug/publish',
    { schema: publishSchema, preHandler: [authenticateAdmin] },
    async (request, reply) => {
      try {
        const doc = await legalService.publish(request.params.slug, request.body?.version);
        return doc;
      } catch (err: any) {
        if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  /** POST /legal/:slug/unpublish — Unpublish all versions (admin) */
  fastify.post<{ Params: { slug: string } }>(
    '/:slug/unpublish',
    { schema: getDocumentSchema, preHandler: [authenticateAdmin] },
    async (request, reply) => {
      try {
        await legalService.unpublish(request.params.slug);
        return { message: 'Document unpublished' };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  /** PUT /legal/:slug/:version — Update an unpublished version (admin) */
  fastify.put<{ Params: { slug: string; version: string }; Body: UpdateDocumentDto }>(
    '/:slug/:version',
    { schema: updateDocumentSchema, preHandler: [authenticateAdmin] },
    async (request, reply) => {
      try {
        const doc = await legalService.updateVersion(
          request.params.slug,
          parseInt(request.params.version, 10),
          request.body,
        );
        return doc;
      } catch (err: any) {
        if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
        if (err.statusCode === 409) return reply.status(409).send({ error: err.message });
        return reply.status(500).send({ error: err.message });
      }
    },
  );
};

export default legalController;
