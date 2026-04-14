import { FastifyPluginAsync } from 'fastify';
import { authenticateOrganizer } from '../lib/auth.js';
import { OrganizerService } from './organizer.service.js';
import { EventService } from '../event/event.service.js';
import { supabase } from '../lib/supabase.js';
import { fromDbEvent } from '../event/util.js';
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

  // GET /organizer/events — list events owned by this organizer
  fastify.get(
    '/events',
    { preHandler: [authenticateOrganizer] },
    async (request) => {
      const organizerId = getUserId(request);
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('organizer_id', organizerId)
        .order('created_at', { ascending: false });

      if (error) throw new Error(`Failed to fetch organizer events: ${error.message}`);
      return { events: (data || []).map((row: any) => fromDbEvent(row)) };
    },
  );

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

  // POST /organizer/agreements/:id/email — email agreement to organizer + vendor
  fastify.post(
    '/agreements/:id/email',
    { preHandler: [authenticateOrganizer] },
    async (request) => {
      const { id } = request.params as { id: string };
      const organizerId = getUserId(request);
      const agreement = await service.getAgreement(organizerId, id);

      // Get organizer + vendor emails
      const { getOrganizerEmail } = await import('../organizer-emails/organizer-email.service.js');
      const orgEmail = await getOrganizerEmail(organizerId);

      const { data: vendorUsers } = await supabase
        .from('vendor_users')
        .select('email')
        .eq('vendor_id', agreement.vendorId)
        .eq('is_active', true)
        .limit(5);

      const vendorEmails = (vendorUsers || []).map((u: any) => u.email).filter(Boolean);
      const recipients = [...(orgEmail ? [orgEmail] : []), ...vendorEmails];

      if (recipients.length === 0) {
        return { message: 'No email addresses found' };
      }

      const { sendEmail } = await import('../lib/email.js');
      const ORGANIZER_APP_URL = process.env.ORGANIZER_APP_URL || 'https://nownow-organizer.vercel.app';

      const effectiveFrom = new Date(agreement.effectiveFrom).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });
      const effectiveUntil = agreement.effectiveUntil
        ? new Date(agreement.effectiveUntil).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'No end date';

      await sendEmail({
        to: recipients,
        subject: `Agreement: ${agreement.vendorName || 'Vendor'} — ${agreement.eventName || 'Event'}`,
        html: `
          <h2>Vendor Agreement</h2>
          <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:500px;">
            <tr><td style="padding:8px 16px 8px 0;font-weight:bold;border-bottom:1px solid #eee;">Event</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${agreement.eventName || 'N/A'}</td></tr>
            <tr><td style="padding:8px 16px 8px 0;font-weight:bold;border-bottom:1px solid #eee;">Vendor</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${agreement.vendorName || 'N/A'}</td></tr>
            <tr><td style="padding:8px 16px 8px 0;font-weight:bold;border-bottom:1px solid #eee;">Commission Rate</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${agreement.commissionRate}%</td></tr>
            <tr><td style="padding:8px 16px 8px 0;font-weight:bold;border-bottom:1px solid #eee;">Status</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${agreement.status.toUpperCase()}</td></tr>
            <tr><td style="padding:8px 16px 8px 0;font-weight:bold;border-bottom:1px solid #eee;">Effective From</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${effectiveFrom}</td></tr>
            <tr><td style="padding:8px 16px 8px 0;font-weight:bold;border-bottom:1px solid #eee;">Effective Until</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${effectiveUntil}</td></tr>
            ${agreement.notes ? `<tr><td style="padding:8px 16px 8px 0;font-weight:bold;">Notes</td><td style="padding:8px 0;">${agreement.notes}</td></tr>` : ''}
          </table>
          <p><a href="${ORGANIZER_APP_URL}/agreements">View agreements</a></p>
        `,
      });

      return { message: 'Agreement emailed successfully' };
    },
  );

  // GET /organizer/agreements/:id/download — download agreement as CSV
  fastify.get(
    '/agreements/:id/download',
    { preHandler: [authenticateOrganizer] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const organizerId = getUserId(request);
      const agreement = await service.getAgreement(organizerId, id);

      const { toCSV } = await import('../lib/csv.js');

      const rows = [{
        event: agreement.eventName || 'N/A',
        vendor: agreement.vendorName || 'N/A',
        commission_rate: `${agreement.commissionRate}%`,
        status: agreement.status,
        effective_from: agreement.effectiveFrom,
        effective_until: agreement.effectiveUntil || 'No end date',
        notes: agreement.notes || '',
        created: agreement.createdAt,
      }];

      const csv = toCSV(rows, [
        { key: 'event', label: 'Event' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'commission_rate', label: 'Commission Rate' },
        { key: 'status', label: 'Status' },
        { key: 'effective_from', label: 'Effective From' },
        { key: 'effective_until', label: 'Effective Until' },
        { key: 'notes', label: 'Notes' },
        { key: 'created', label: 'Created' },
      ]);

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="agreement-${id.slice(0, 8)}.csv"`);
      return reply.send(csv);
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
