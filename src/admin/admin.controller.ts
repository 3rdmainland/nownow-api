import { FastifyPluginAsync } from 'fastify';
import { authenticateAdmin } from '../lib/auth.js';
import { AdminService } from './admin.service.js';
import { AdminJwtPayload } from '../admin-auth/admin-auth.types.js';
import { supabase } from '../lib/supabase.js';
import { sendEmail } from '../lib/email.js';
import {
  platformStatsSchema,
  userListSchema,
  suspendUserSchema,
  unsuspendUserSchema,
  resetUserPasswordSchema,
  getUserDetailSchema,
  updateUserSchema,
  deleteUserSchema,
  inviteUserSchema,
  sendResetLinkSchema,
  auditLogsSchema,
  getConfigSchema,
  setConfigSchema,
  vendorPipelineSchema,
  stakeholderStatsSchema,
  revenueReportSchema,
  operationalSnapshotSchema,
  globalSearchSchema,
  customerProfileSchema,
  customerOrdersSchema,
  overrideOrderStatusSchema,
  adminRefundSchema,
  reconciliationSchema,
  peakHoursSchema,
  vendorPerformanceSchema,
  popularItemsSchema,
  conversionFunnelSchema,
  alertsSchema,
  acknowledgeAlertSchema,
  systemHealthSchema,
} from './admin.schema.js';

const adminController: FastifyPluginAsync = async (fastify) => {
  const adminService = new AdminService();

  // All routes require admin auth
  fastify.addHook('preHandler', authenticateAdmin);

  // GET /admin/operational-snapshot
  fastify.get('/operational-snapshot', { schema: operationalSnapshotSchema }, async (request, reply) => {
    return adminService.getOperationalSnapshot();
  });

  // GET /admin/search?q=term
  fastify.get('/search', { schema: globalSearchSchema }, async (request, reply) => {
    const { q, limit } = request.query as { q: string; limit?: number };
    return adminService.globalSearch(q, limit);
  });

  // GET /admin/stats
  fastify.get('/stats', { schema: platformStatsSchema }, async (request, reply) => {
    return adminService.getPlatformStats();
  });

  // GET /admin/users/:type
  fastify.get('/users/:type', { schema: userListSchema }, async (request, reply) => {
    const { type } = request.params as { type: string };
    const { search, page, limit } = request.query as { search?: string; page?: number; limit?: number };
    const result = await adminService.getUsers({ type: type as any, search, page, limit });
    return { ...result, page: page || 1, limit: limit || 20 };
  });

  // PATCH /admin/users/:type/:id/suspend
  fastify.patch('/users/:type/:id/suspend', { schema: suspendUserSchema }, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    const { userId } = request.user as AdminJwtPayload;
    await adminService.suspendUser(type, id);
    await adminService.logAction(userId, 'user_suspended', type, id, null, request.ip);

    // Notify user of suspension
    const table = type === 'vendor' ? 'vendor_users' : type === 'organizer' ? 'organizer_users' : null;
    if (table) {
      const { data: user } = await supabase.from(table).select('email, name').eq('id', id).single();
      if (user?.email) {
        void sendEmail({
          to: user.email,
          subject: 'Your NowNow account has been suspended',
          html: `
            <h2>Account Suspended</h2>
            <p>Hi ${user.name || 'there'},</p>
            <p>Your NowNow account has been suspended. You will not be able to access the platform until this is resolved.</p>
            <p>If you believe this is a mistake, please contact our support team.</p>
          `,
        }).catch(err => fastify.log.error(err, 'Failed to send suspension email'));
      }
    }

    return { message: 'User suspended' };
  });

  // PATCH /admin/users/:type/:id/unsuspend
  fastify.patch('/users/:type/:id/unsuspend', { schema: unsuspendUserSchema }, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    const { userId } = request.user as AdminJwtPayload;
    await adminService.unsuspendUser(type, id);
    await adminService.logAction(userId, 'user_unsuspended', type, id, null, request.ip);
    return { message: 'User unsuspended' };
  });

  // POST /admin/users/:type/:id/reset-password
  fastify.post('/users/:type/:id/reset-password', { schema: resetUserPasswordSchema }, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    const { newPassword } = request.body as { newPassword: string };
    const { userId } = request.user as AdminJwtPayload;
    await adminService.resetUserPassword(type, id, newPassword);
    await adminService.logAction(userId, 'password_reset', type, id, null, request.ip);
    return { message: 'Password reset successfully' };
  });

  // GET /admin/users/:type/:id — View user detail
  fastify.get('/users/:type/:id', { schema: getUserDetailSchema }, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    return adminService.getUserDetail(type, id);
  });

  // PATCH /admin/users/:type/:id — Update user
  fastify.patch('/users/:type/:id', { schema: updateUserSchema }, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    const payload = request.body as Record<string, unknown>;
    const { userId } = request.user as AdminJwtPayload;
    await adminService.updateUser(type, id, payload);
    await adminService.logAction(userId, 'user_updated', type, id, payload, request.ip);
    return { message: 'User updated' };
  });

  // DELETE /admin/users/:type/:id — Delete user
  fastify.delete('/users/:type/:id', { schema: deleteUserSchema }, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    const { userId } = request.user as AdminJwtPayload;
    await adminService.deleteUser(type, id);
    await adminService.logAction(userId, 'user_deleted', type, id, null, request.ip);
    return { message: 'User deleted' };
  });

  // POST /admin/users/:type/invite — Invite vendor/organizer
  fastify.post('/users/:type/invite', { schema: inviteUserSchema }, async (request, reply) => {
    const { type } = request.params as { type: string };
    const { email, vendorId } = request.body as { email: string; vendorId?: string };
    const { userId } = request.user as AdminJwtPayload;
    const result = await adminService.inviteUser(type, { email, vendorId });
    await adminService.logAction(userId, 'user_invited', type, null, { email, vendorId }, request.ip);
    return result;
  });

  // POST /admin/users/:type/:id/send-reset-link — Generate reset link
  fastify.post('/users/:type/:id/send-reset-link', { schema: sendResetLinkSchema }, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    const { userId } = request.user as AdminJwtPayload;
    const result = await adminService.sendResetLink(type, id);
    await adminService.logAction(userId, 'reset_link_sent', type, id, null, request.ip);
    return result;
  });

  // GET /admin/audit-logs
  fastify.get('/audit-logs', { schema: auditLogsSchema }, async (request, reply) => {
    const filters = request.query as {
      adminUserId?: string;
      action?: string;
      startDate?: string;
      endDate?: string;
      page?: number;
      limit?: number;
    };
    const result = await adminService.getAuditLogs(filters);
    return { ...result, page: filters.page || 1, limit: filters.limit || 50 };
  });

  // GET /admin/config
  fastify.get('/config', { schema: getConfigSchema }, async (request, reply) => {
    const config = await adminService.getConfig();
    return { config };
  });

  // PUT /admin/config/:key
  fastify.put('/config/:key', { schema: setConfigSchema }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const { value } = request.body as { value: unknown };
    const { userId } = request.user as AdminJwtPayload;
    await adminService.setConfig(key, value, userId);
    await adminService.logAction(userId, 'config_updated', 'platform_config', key, { value }, request.ip);
    return { message: 'Config updated' };
  });

  // GET /admin/vendor-pipeline
  fastify.get('/vendor-pipeline', { schema: vendorPipelineSchema }, async (request, reply) => {
    const stages = await adminService.getVendorPipeline();
    return { stages };
  });

  // GET /admin/stakeholder-stats
  fastify.get('/stakeholder-stats', { schema: stakeholderStatsSchema }, async (request, reply) => {
    return adminService.getStakeholderStats();
  });

  // GET /admin/revenue-report
  fastify.get('/revenue-report', { schema: revenueReportSchema, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
    return adminService.getRevenueReport(startDate, endDate);
  });

  // GET /admin/customers/:phone
  fastify.get('/customers/:phone', { schema: customerProfileSchema }, async (request, reply) => {
    const { phone } = request.params as { phone: string };
    return adminService.getCustomerProfile(decodeURIComponent(phone));
  });

  // GET /admin/customers/:phone/orders
  fastify.get('/customers/:phone/orders', { schema: customerOrdersSchema }, async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const { page, limit } = request.query as { page?: number; limit?: number };
    return adminService.getCustomerOrderHistory(decodeURIComponent(phone), page, limit);
  });

  // PATCH /admin/orders/:id/override-status
  fastify.patch('/orders/:id/override-status', { schema: overrideOrderStatusSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status, reason } = request.body as { status: string; reason: string };
    const { userId } = request.user as AdminJwtPayload;
    await adminService.overrideOrderStatus(id, status, userId, reason);
    return { message: 'Order status updated' };
  });

  // POST /admin/orders/:id/admin-refund
  fastify.post('/orders/:id/admin-refund', { schema: adminRefundSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { type, amount, reason } = request.body as { type: 'full' | 'partial'; amount?: number; reason: string };
    const { userId } = request.user as AdminJwtPayload;
    await adminService.adminRefundOrder(id, type, amount, reason, userId);
    return { message: 'Refund processed' };
  });

  // GET /admin/reconciliation
  fastify.get('/reconciliation', { schema: reconciliationSchema, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
    return adminService.getReconciliationReport(startDate, endDate);
  });

  // GET /admin/analytics/peak-hours
  fastify.get('/analytics/peak-hours', { schema: peakHoursSchema, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { startDate, endDate, eventId } = request.query as { startDate?: string; endDate?: string; eventId?: string };
    return adminService.getPeakHoursAnalysis(startDate, endDate, eventId);
  });

  // GET /admin/analytics/vendor-performance
  fastify.get('/analytics/vendor-performance', { schema: vendorPerformanceSchema, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { startDate, endDate, eventId } = request.query as { startDate?: string; endDate?: string; eventId?: string };
    return adminService.getVendorPerformance(startDate, endDate, eventId);
  });

  // GET /admin/analytics/popular-items
  fastify.get('/analytics/popular-items', { schema: popularItemsSchema }, async (request, reply) => {
    const { startDate, endDate, eventId, limit } = request.query as { startDate?: string; endDate?: string; eventId?: string; limit?: number };
    return adminService.getPopularItems(startDate, endDate, eventId, limit);
  });

  // GET /admin/analytics/conversion-funnel
  fastify.get('/analytics/conversion-funnel', { schema: conversionFunnelSchema }, async (request, reply) => {
    const { startDate, endDate, eventId } = request.query as { startDate?: string; endDate?: string; eventId?: string };
    return adminService.getConversionFunnel(startDate, endDate, eventId);
  });

  // GET /admin/alerts
  fastify.get('/alerts', { schema: alertsSchema }, async (request, reply) => {
    return adminService.getActiveAlerts();
  });

  // PATCH /admin/alerts/:id/acknowledge
  fastify.patch('/alerts/:id/acknowledge', { schema: acknowledgeAlertSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await adminService.acknowledgeAlert(id);
    return { message: 'Alert acknowledged' };
  });

  // GET /admin/health
  fastify.get('/health', { schema: systemHealthSchema }, async (request, reply) => {
    return adminService.getSystemHealth();
  });

  // PATCH /admin/vendors/:id/features — toggle vendor feature flags
  fastify.patch<{ Params: { id: string } }>('/vendors/:id/features', async (request, reply) => {
    try {
      const { id } = request.params;
      const { canCreateEvents, vendorTier } = request.body as {
        canCreateEvents?: boolean;
        vendorTier?: 'standard' | 'lite' | 'lite_only';
      };

      const updates: Record<string, any> = {};
      if (canCreateEvents !== undefined) updates.can_create_events = canCreateEvents;
      if (vendorTier !== undefined) {
        if (!['standard', 'lite', 'lite_only'].includes(vendorTier)) {
          return reply.status(400).send({ error: 'vendorTier must be "standard", "lite", or "lite_only"' });
        }
        updates.vendor_tier = vendorTier;
      }

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: 'No valid fields to update' });
      }

      const { data, error } = await supabase
        .from('vendors')
        .update(updates)
        .eq('id', id)
        .select('id, can_create_events, vendor_tier')
        .single();

      if (error) throw new Error(`Failed to update vendor features: ${error.message}`);

      return { vendor: data };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /admin/vendor-events — list all vendor-created events
  fastify.get('/vendor-events', async (request, reply) => {
    try {
      const { data, error } = await supabase
        .from('vendor_events')
        .select('*, events(name, code, start_date, end_date, status), vendors(name)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw new Error(`Failed to fetch vendor events: ${error.message}`);

      return { vendorEvents: data || [] };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /admin/vendor-events/:id/status — deactivate a vendor event
  fastify.patch<{ Params: { id: string } }>('/vendor-events/:id/status', async (request, reply) => {
    try {
      const { status } = request.body as { status: string };
      const { id } = request.params;

      const { data: ve, error: veError } = await supabase
        .from('vendor_events')
        .select('event_id')
        .eq('id', id)
        .single();

      if (veError || !ve) return reply.status(404).send({ error: 'Vendor event not found' });

      const { error } = await supabase
        .from('events')
        .update({ status })
        .eq('id', ve.event_id);

      if (error) throw new Error(`Failed to update event status: ${error.message}`);

      return { success: true };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
};

export default adminController;
