import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { SettlementService } from './settlement.service.js';
import { OrganizerService } from '../organizer/organizer.service.js';
import { notifyOrganizer } from '../notifications/notify-helpers.js';
import { UpsertBankDetailsPayload } from './settlement.types.js';
import {
  vendorGetBankDetailsSchema,
  vendorUpsertBankDetailsSchema,
  vendorPayoutsSchema,
  vendorSummarySchema,
  vendorAgreementsSchema,
  vendorAcceptAgreementSchema,
  vendorDeclineAgreementSchema,
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
      const result = await organizerService.acceptAgreement(vendorId, id, { ip: request.ip });

      // Fire-and-forget notification to organizer
      (async () => {
        try {
          const { supabase } = await import('../lib/supabase.js');
          const { data: agreement } = await supabase
            .from('organizer_vendor_agreements')
            .select('organizer_id, event_id, events(name), vendors(business_name)')
            .eq('id', id)
            .single();

          if (agreement) {
            const vendorName = (agreement as any).vendors?.business_name || 'A vendor';
            const eventName = (agreement as any).events?.name || 'your event';
            notifyOrganizer(agreement.organizer_id, {
              title: 'Vendor Accepted Invitation',
              message: `${vendorName} accepted the invitation to "${eventName}".`,
              type: 'success',
              actionUrl: `/events/${agreement.event_id}`,
            });

            // Email notification
            const { getOrganizerEmail } = await import('../organizer-emails/organizer-email.service.js');
            const { sendEmail } = await import('../lib/email.js');
            const orgEmail = await getOrganizerEmail(agreement.organizer_id);
            if (orgEmail) {
                const ORGANIZER_APP_URL = process.env.ORGANIZER_APP_URL || 'https://nownow-organizer.vercel.app';
                await sendEmail({
                    to: orgEmail,
                    subject: `${vendorName} accepted your invite to "${eventName}"`,
                    html: `
                        <h2>Vendor Accepted</h2>
                        <p><strong>${vendorName}</strong> has accepted your invitation to <strong>${eventName}</strong>.</p>
                        <p><a href="${ORGANIZER_APP_URL}/events/${agreement.event_id}">View event</a></p>
                    `,
                });
            }
          }
        } catch { /* don't fail accept on notification error */ }
      })();

      return result;
    },
  );

  // POST /vendor/:vendorId/agreements/:id/decline
  fastify.post(
    '/:vendorId/agreements/:id/decline',
    { schema: vendorDeclineAgreementSchema, preHandler: [authenticate] },
    async (request, reply) => {
      const { vendorId, id } = request.params as { vendorId: string; id: string };
      if (!assertOwnership(request, reply, vendorId)) return;

      const result = await organizerService.declineAgreement(vendorId, id);

      // Fire-and-forget notification to organizer
      (async () => {
        try {
          const { supabase } = await import('../lib/supabase.js');
          const { data: agreement } = await supabase
            .from('organizer_vendor_agreements')
            .select('organizer_id, event_id, events(name), vendors(business_name)')
            .eq('id', id)
            .single();

          if (agreement) {
            const vendorName = (agreement as any).vendors?.business_name || 'A vendor';
            const eventName = (agreement as any).events?.name || 'your event';
            notifyOrganizer(agreement.organizer_id, {
              title: 'Vendor Declined Invitation',
              message: `${vendorName} declined the invitation to "${eventName}".`,
              type: 'warning',
              actionUrl: `/events/${agreement.event_id}`,
            });

            // Email notification
            const { getOrganizerEmail } = await import('../organizer-emails/organizer-email.service.js');
            const { sendEmail } = await import('../lib/email.js');
            const orgEmail = await getOrganizerEmail(agreement.organizer_id);
            if (orgEmail) {
                const ORGANIZER_APP_URL = process.env.ORGANIZER_APP_URL || 'https://nownow-organizer.vercel.app';
                await sendEmail({
                    to: orgEmail,
                    subject: `${vendorName} declined your invite to "${eventName}"`,
                    html: `
                        <h2>Vendor Declined</h2>
                        <p><strong>${vendorName}</strong> has declined your invitation to <strong>${eventName}</strong>.</p>
                        <p><a href="${ORGANIZER_APP_URL}/events/${agreement.event_id}">View event</a></p>
                    `,
                });
            }
          }
        } catch { /* don't fail decline on notification error */ }
      })();

      return result;
    },
  );
};

export default vendorSettlementController;
