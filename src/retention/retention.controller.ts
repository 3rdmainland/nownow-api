import { FastifyPluginAsync } from 'fastify';
import { authenticateCustomer, authenticateAdmin } from '../lib/auth.js';
import { ConsentService } from './consent.service.js';
import { grantConsentSchema, revokeConsentSchema, getConsentSchema } from './retention.schema.js';
import { supabase } from '../lib/supabase.js';
import type { ConsentType } from './retention.types.js';
import { requireFeature } from '../lib/feature-flags.js';

const consentService = new ConsentService();

const retentionController: FastifyPluginAsync = async (fastify) => {
  // Gate entire controller behind the 'retention' feature flag
  fastify.addHook('preHandler', requireFeature('retention'));
  // ── Consent endpoints (customer-facing) ────────────────────────────

  fastify.post<{
    Body: { eventId: string; consentType: ConsentType };
  }>(
    '/consent',
    { schema: grantConsentSchema, preHandler: [authenticateCustomer] },
    async (request, reply) => {
      const { customerId, phone } = request.user as { customerId: string; phone: string };
      const { eventId, consentType } = request.body;

      try {
        await consentService.grantConsent(customerId, phone, eventId, consentType);
        return { success: true };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  fastify.delete<{
    Body: { eventId: string; consentType: ConsentType };
  }>(
    '/consent',
    { schema: revokeConsentSchema, preHandler: [authenticateCustomer] },
    async (request, reply) => {
      const { customerId } = request.user as { customerId: string };
      const { eventId, consentType } = request.body;

      try {
        await consentService.revokeConsent(customerId, eventId, consentType);
        return { success: true };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  fastify.get<{
    Params: { eventId: string };
  }>(
    '/consent/:eventId',
    { schema: getConsentSchema, preHandler: [authenticateCustomer] },
    async (request, reply) => {
      const { customerId } = request.user as { customerId: string };
      const { eventId } = request.params;

      try {
        const status = await consentService.getConsentStatus(customerId, eventId);
        return status;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  // ── Token-based opt-out (no auth — POPIA compliance) ──────────────

  fastify.post<{
    Body: { token: string };
  }>(
    '/opt-out',
    async (request, reply) => {
      const { token } = request.body ?? {};
      if (!token || typeof token !== 'string') {
        return reply.status(400).send({ error: 'Missing opt-out token' });
      }

      // Token is base64(phone) — simple, no secrets needed for revocation
      let phone: string;
      try {
        phone = Buffer.from(token, 'base64').toString('utf-8');
        // Basic phone validation
        if (!/^\+?\d{7,15}$/.test(phone.replace(/\s/g, ''))) {
          return reply.status(400).send({ error: 'Invalid opt-out token' });
        }
      } catch {
        return reply.status(400).send({ error: 'Invalid opt-out token' });
      }

      try {
        const count = await consentService.revokeAllByPhone(phone);
        return { success: true, revokedCount: count };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  // ── Admin stats endpoint ───────────────────────────────────────────

  fastify.get(
    '/stats',
    { preHandler: [authenticateAdmin] },
    async (_request, reply) => {
      try {
        // Nudge stats by status
        const { data: nudgeStats, error: nudgeError } = await supabase
          .from('retention_nudges')
          .select('status');

        if (nudgeError) {
          return reply.status(500).send({ error: nudgeError.message });
        }

        const nudgeCounts: Record<string, number> = {};
        for (const row of nudgeStats ?? []) {
          nudgeCounts[row.status] = (nudgeCounts[row.status] ?? 0) + 1;
        }

        // WhatsApp message stats
        const { data: msgStats, error: msgError } = await supabase
          .from('whatsapp_messages')
          .select('category, cost_zar');

        if (msgError) {
          return reply.status(500).send({ error: msgError.message });
        }

        let totalMessages = 0;
        let totalCost = 0;
        const categoryCounts: Record<string, number> = {};

        for (const row of msgStats ?? []) {
          totalMessages++;
          totalCost += row.cost_zar ?? 0;
          categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;
        }

        return {
          nudges: nudgeCounts,
          messages: {
            total: totalMessages,
            totalCostZar: Math.round(totalCost * 100) / 100,
            byCategory: categoryCounts,
          },
        };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );
};

export default retentionController;
