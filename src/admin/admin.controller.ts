import { FastifyPluginAsync } from 'fastify';
import { authenticateAdmin } from '../lib/auth.js';
import { AdminService } from './admin.service.js';
import { AdminJwtPayload } from '../admin-auth/admin-auth.types.js';
import {
  platformStatsSchema,
  userListSchema,
  suspendUserSchema,
  unsuspendUserSchema,
  resetUserPasswordSchema,
  auditLogsSchema,
  getConfigSchema,
  setConfigSchema,
  vendorPipelineSchema,
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

  // GET /admin/revenue-report
  fastify.get('/revenue-report', { schema: revenueReportSchema }, async (request, reply) => {
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
  fastify.get('/reconciliation', { schema: reconciliationSchema }, async (request, reply) => {
    const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
    return adminService.getReconciliationReport(startDate, endDate);
  });

  // GET /admin/analytics/peak-hours
  fastify.get('/analytics/peak-hours', { schema: peakHoursSchema }, async (request, reply) => {
    const { startDate, endDate, eventId } = request.query as { startDate?: string; endDate?: string; eventId?: string };
    return adminService.getPeakHoursAnalysis(startDate, endDate, eventId);
  });

  // GET /admin/analytics/vendor-performance
  fastify.get('/analytics/vendor-performance', { schema: vendorPerformanceSchema }, async (request, reply) => {
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
};

export default adminController;
