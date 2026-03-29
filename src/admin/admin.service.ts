import { supabase } from '../lib/supabase.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import {
  PlatformStats,
  AuditLogEntry,
  PlatformConfigEntry,
  VendorPipelineStage,
  PipelineVendor,
  RevenueReport,
  UserListParams,
  OperationalSnapshot,
  AdminOrderSummary,
  GlobalSearchResult,
  CustomerProfile,
  ReconciliationReport,
  PeakHoursAnalysis,
  VendorPerformance,
  PopularItemsRanking,
  ConversionFunnel,
  Alert,
  SystemHealth,
  StakeholderStats,
  VendorUserDetail,
  OrganizerUserDetail,
  CustomerDetail,
  UserDetail,
} from './admin.types.js';
import { getConnectionStats, broadcastToAdmins } from '../websocket/index.js';
import redis, { cache } from '../lib/redis.js';
import { invalidateFeatureFlagsCache } from '../lib/feature-flags.js';
import bcrypt from 'bcryptjs';
import { AuthService } from '../auth/auth.service.js';
import { OrganizerAuthService } from '../organizer/organizer-auth.service.js';

const SALT_ROUNDS = 10;

const USER_TABLES: Record<string, string> = {
  vendor: 'vendor_users',
  organizer: 'organizer_users',
  customer: 'customers',
};

export class AdminService {
  async getPlatformStats(): Promise<PlatformStats> {
    const [orders, events, vendors, organizers, customers] = await Promise.all([
      supabase.from('orders').select('id, total', { count: 'exact' }),
      supabase.from('events').select('id', { count: 'exact' }),
      supabase.from('vendor_users').select('id', { count: 'exact' }),
      supabase.from('organizer_users').select('id', { count: 'exact' }),
      supabase.from('customers').select('id', { count: 'exact' }),
    ]);

    const totalRevenue = (orders.data || []).reduce(
      (sum: number, o: any) => sum + (Number(o.total) || 0),
      0
    );

    return {
      totalOrders: orders.count || 0,
      totalRevenue,
      totalEvents: events.count || 0,
      totalVendors: vendors.count || 0,
      totalOrganizers: organizers.count || 0,
      totalCustomers: customers.count || 0,
    };
  }

  async getUsers(params: UserListParams): Promise<{ users: any[]; total: number }> {
    const table = USER_TABLES[params.type];
    if (!table) throw new ValidationError(`Invalid user type: ${params.type}`);

    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    let query = supabase
      .from(table)
      .select('*', { count: 'exact' });

    if (params.search) {
      if (params.type === 'customer') {
        query = query.or(`phone.ilike.%${params.search}%,name.ilike.%${params.search}%`);
      } else {
        query = query.or(`email.ilike.%${params.search}%,name.ilike.%${params.search}%`);
      }
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Failed to fetch users: ${error.message}`);

    // Strip password hashes
    const users = (data || []).map((u: any) => {
      const { password_hash, ...safe } = u;
      return safe;
    });

    return { users, total: count || 0 };
  }

  async suspendUser(type: string, id: string): Promise<void> {
    const table = USER_TABLES[type];
    if (!table) throw new ValidationError(`Invalid user type: ${type}`);

    const { data, error: fetchErr } = await supabase
      .from(table)
      .select('id')
      .eq('id', id)
      .single();

    if (fetchErr || !data) throw new NotFoundError('User not found');

    const { error } = await supabase
      .from(table)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(`Failed to suspend user: ${error.message}`);
  }

  async unsuspendUser(type: string, id: string): Promise<void> {
    const table = USER_TABLES[type];
    if (!table) throw new ValidationError(`Invalid user type: ${type}`);

    const { data, error: fetchErr } = await supabase
      .from(table)
      .select('id')
      .eq('id', id)
      .single();

    if (fetchErr || !data) throw new NotFoundError('User not found');

    const { error } = await supabase
      .from(table)
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(`Failed to unsuspend user: ${error.message}`);
  }

  async resetUserPassword(type: string, id: string, newPassword: string): Promise<void> {
    const table = USER_TABLES[type];
    if (!table) throw new ValidationError(`Invalid user type: ${type}`);
    if (type === 'customer') throw new ValidationError('Cannot reset password for customers (OTP-based auth)');

    const { data, error: fetchErr } = await supabase
      .from(table)
      .select('id')
      .eq('id', id)
      .single();

    if (fetchErr || !data) throw new NotFoundError('User not found');

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const { error } = await supabase
      .from(table)
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(`Failed to reset password: ${error.message}`);
  }

  async getAuditLogs(filters: {
    adminUserId?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<{ logs: AuditLogEntry[]; total: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('admin_audit_logs')
      .select('*, admin_users!admin_audit_logs_admin_user_id_fkey(email)', { count: 'exact' });

    if (filters.adminUserId) query = query.eq('admin_user_id', filters.adminUserId);
    if (filters.action) query = query.eq('action', filters.action);
    if (filters.startDate) query = query.gte('created_at', filters.startDate);
    if (filters.endDate) query = query.lte('created_at', `${filters.endDate}T23:59:59.999Z`);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Failed to fetch audit logs: ${error.message}`);

    const logs: AuditLogEntry[] = (data || []).map((row: any) => ({
      id: row.id,
      adminUserId: row.admin_user_id,
      adminEmail: row.admin_users?.email || null,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: row.details,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    }));

    return { logs, total: count || 0 };
  }

  async logAction(
    adminUserId: string,
    action: string,
    resourceType: string,
    resourceId: string | null,
    details: Record<string, unknown> | null,
    ipAddress?: string
  ): Promise<void> {
    await supabase.from('admin_audit_logs').insert([{
      admin_user_id: adminUserId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details,
      ip_address: ipAddress || null,
    }]);
  }

  async getConfig(): Promise<PlatformConfigEntry[]> {
    const { data, error } = await supabase
      .from('platform_config')
      .select('*')
      .order('key');

    if (error) throw new Error(`Failed to fetch config: ${error.message}`);

    return (data || []).map((row: any) => ({
      key: row.key,
      value: row.value,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    }));
  }

  async setConfig(key: string, value: unknown, adminUserId: string): Promise<void> {
    const { error } = await supabase
      .from('platform_config')
      .upsert({
        key,
        value,
        updated_by: adminUserId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    if (error) throw new Error(`Failed to set config: ${error.message}`);

    if (key === 'feature_flags') {
      await invalidateFeatureFlagsCache();
    }
  }

  async getVendorPipeline(): Promise<VendorPipelineStage[]> {
    // Count vendors at each onboarding stage + fetch top 10 recent per stage
    const [
      invited, registered, menuSetup, firstEvent, active,
      invitedVendors, registeredVendors, menuSetupVendors, firstEventVendors, activeVendors,
    ] = await Promise.all([
      // Counts
      supabase.from('vendor_invites').select('id', { count: 'exact' }).is('used_at', null),
      supabase.from('vendor_users').select('id', { count: 'exact' }),
      supabase.from('vendor_users').select('id, vendors!inner(id, menu_items!inner(id))', { count: 'exact' }),
      supabase.from('vendor_users').select('id, vendors!inner(id, event_vendors!inner(id))', { count: 'exact' }),
      supabase.from('vendor_users').select('id', { count: 'exact' }).eq('is_active', true),
      // Vendor details (top 10 per stage)
      supabase.from('vendor_invites').select('id, email, created_at').is('used_at', null).order('created_at', { ascending: false }).limit(10),
      supabase.from('vendor_users').select('id, name, email, created_at').order('created_at', { ascending: false }).limit(10),
      supabase.from('vendor_users').select('id, name, email, created_at, vendors!inner(id, menu_items!inner(id))').order('created_at', { ascending: false }).limit(10),
      supabase.from('vendor_users').select('id, name, email, created_at, vendors!inner(id, event_vendors!inner(id))').order('created_at', { ascending: false }).limit(10),
      supabase.from('vendor_users').select('id, name, email, created_at').eq('is_active', true).order('created_at', { ascending: false }).limit(10),
    ]);

    const mapInvites = (data: any[]): PipelineVendor[] =>
      (data || []).map((v: any) => ({ id: v.id, name: null, email: v.email, date: v.created_at }));

    const mapUsers = (data: any[]): PipelineVendor[] =>
      (data || []).map((v: any) => ({ id: v.id, name: v.name || null, email: v.email, date: v.created_at }));

    return [
      { stage: 'Invited', count: invited.count || 0, vendors: mapInvites(invitedVendors.data || []) },
      { stage: 'Registered', count: registered.count || 0, vendors: mapUsers(registeredVendors.data || []) },
      { stage: 'Menu Setup', count: menuSetup.count || 0, vendors: mapUsers(menuSetupVendors.data || []) },
      { stage: 'First Event', count: firstEvent.count || 0, vendors: mapUsers(firstEventVendors.data || []) },
      { stage: 'Active', count: active.count || 0, vendors: mapUsers(activeVendors.data || []) },
    ];
  }

  async getOperationalSnapshot(): Promise<OperationalSnapshot> {
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const twentyFourHAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const [pending, failed, stale, activeEvents, orders24h, recentOrdersRes] = await Promise.all([
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
      supabase.from('orders').select('id', { count: 'exact', head: true }).in('payment_status', ['cancelled', 'expired', 'failed']),
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'PENDING').lt('created_at', tenMinAgo),
      supabase.from('events').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('orders').select('id, total', { count: 'exact' }).gte('created_at', twentyFourHAgo),
      supabase.from('orders')
        .select('id, phone, total, status, payment_status, created_at, vendor_id, event_id')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const revenueLast24h = (orders24h.data || []).reduce(
      (sum: number, o: any) => sum + (Number(o.total) || 0), 0
    );

    // Enrich recent orders with vendor/event names
    const recentOrders: AdminOrderSummary[] = [];
    if (recentOrdersRes.data && recentOrdersRes.data.length > 0) {
      const vendorIds = [...new Set(recentOrdersRes.data.map((o: any) => o.vendor_id).filter(Boolean))];
      const eventIds = [...new Set(recentOrdersRes.data.map((o: any) => o.event_id).filter(Boolean))];

      const [vendorsRes, eventsRes] = await Promise.all([
        vendorIds.length > 0 ? supabase.from('vendors').select('id, name').in('id', vendorIds) : { data: [] },
        eventIds.length > 0 ? supabase.from('events').select('id, name').in('id', eventIds) : { data: [] },
      ]);

      const vendorMap = new Map((vendorsRes.data || []).map((v: any) => [v.id, v.name]));
      const eventMap = new Map((eventsRes.data || []).map((e: any) => [e.id, e.name]));

      for (const o of recentOrdersRes.data) {
        recentOrders.push({
          id: o.id,
          customerPhone: o.phone || null,
          customerName: null,
          vendorId: o.vendor_id || null,
          vendorName: vendorMap.get(o.vendor_id) || null,
          eventId: o.event_id || null,
          total: Number(o.total) || 0,
          status: o.status,
          paymentStatus: o.payment_status || null,
          createdAt: o.created_at,
          eventName: eventMap.get(o.event_id) || null,
        });
      }
    }

    const wsStats = getConnectionStats();

    return {
      pendingOrders: pending.count || 0,
      failedPayments: failed.count || 0,
      staleOrders: stale.count || 0,
      activeEvents: activeEvents.count || 0,
      wsConnections: wsStats.totalConnections,
      ordersLast24h: orders24h.count || 0,
      revenueLast24h,
      recentOrders,
    };
  }

  async globalSearch(query: string, limit: number = 5): Promise<GlobalSearchResult> {
    const q = query.trim();
    if (!q) return { orders: [], events: [], customers: [], vendors: [] };

    const [ordersRes, eventsRes, customersRes, vendorsRes] = await Promise.all([
      // Search orders by id prefix or phone
      supabase.from('orders')
        .select('id, phone, total, status, payment_status, created_at, vendor_id, event_id')
        .or(`id.ilike.${q}%,phone.ilike.%${q}%`)
        .order('created_at', { ascending: false })
        .limit(limit),
      // Search events by name or code
      supabase.from('events')
        .select('id, name, code, start_date, is_active')
        .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
        .limit(limit),
      // Search customers by phone or name
      supabase.from('customers')
        .select('id, phone, name, created_at')
        .or(`phone.ilike.%${q}%,name.ilike.%${q}%`)
        .limit(limit),
      // Search vendors by name or email
      supabase.from('vendor_users')
        .select('id, name, email')
        .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(limit),
    ]);

    // Enrich orders with vendor/event names
    const orderData = ordersRes.data || [];
    const vendorIds = [...new Set(orderData.map((o: any) => o.vendor_id).filter(Boolean))];
    const eventIds = [...new Set(orderData.map((o: any) => o.event_id).filter(Boolean))];

    const [vendorNames, eventNames] = await Promise.all([
      vendorIds.length > 0 ? supabase.from('vendors').select('id, name').in('id', vendorIds) : { data: [] },
      eventIds.length > 0 ? supabase.from('events').select('id, name').in('id', eventIds) : { data: [] },
    ]);

    const vendorMap = new Map((vendorNames.data || []).map((v: any) => [v.id, v.name]));
    const eventMap = new Map((eventNames.data || []).map((e: any) => [e.id, e.name]));

    return {
      orders: orderData.map((o: any) => ({
        id: o.id,
        customerPhone: o.phone || null,
        customerName: null,
        vendorId: o.vendor_id || null,
        vendorName: vendorMap.get(o.vendor_id) || null,
        eventId: o.event_id || null,
        total: Number(o.total) || 0,
        status: o.status,
        paymentStatus: o.payment_status || null,
        createdAt: o.created_at,
        eventName: eventMap.get(o.event_id) || null,
      })),
      events: (eventsRes.data || []).map((e: any) => ({
        id: e.id,
        name: e.name,
        code: e.code,
        startDate: e.start_date || null,
        status: e.is_active ? 'active' : 'inactive',
      })),
      customers: (customersRes.data || []).map((c: any) => ({
        id: c.id,
        phone: c.phone,
        name: c.name || null,
        createdAt: c.created_at,
      })),
      vendors: (vendorsRes.data || []).map((v: any) => ({
        id: v.id,
        name: v.name,
        email: v.email,
      })),
    };
  }

  async getRevenueReport(startDate?: string, endDate?: string): Promise<RevenueReport> {
    // Try server-side RPC first (much more efficient than pulling all rows)
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_revenue_by_day', {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
      });

      if (!rpcError && rpcData) {
        const byDay = (rpcData as any[]).map((row: any) => ({
          date: row.day,
          revenue: Number(row.revenue) || 0,
          orders: Number(row.order_count) || 0,
        }));
        const totalRevenue = byDay.reduce((sum, d) => sum + d.revenue, 0);
        const orderCount = byDay.reduce((sum, d) => sum + d.orders, 0);
        const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;
        return { totalRevenue, orderCount, averageOrderValue, byDay };
      }
    } catch {
      // RPC not available yet — fall through to client-side aggregation
    }

    // Fallback: client-side aggregation with safety limit
    let query = supabase
      .from('orders')
      .select('total, created_at')
      .eq('status', 'completed');

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', `${endDate}T23:59:59.999Z`);

    const { data, error } = await query.order('created_at', { ascending: true }).limit(10000);

    if (error) throw new Error(`Failed to fetch revenue: ${error.message}`);

    const orders = data || [];
    const totalRevenue = orders.reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);
    const orderCount = orders.length;
    const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

    // Group by day
    const byDayMap = new Map<string, { revenue: number; orders: number }>();
    for (const order of orders) {
      const date = order.created_at.split('T')[0];
      const existing = byDayMap.get(date) || { revenue: 0, orders: 0 };
      existing.revenue += Number(order.total) || 0;
      existing.orders += 1;
      byDayMap.set(date, existing);
    }

    const byDay = Array.from(byDayMap.entries()).map(([date, data]) => ({
      date,
      revenue: data.revenue,
      orders: data.orders,
    }));

    return { totalRevenue, orderCount, averageOrderValue, byDay };
  }

  async getCustomerProfile(phone: string): Promise<CustomerProfile> {
    const { data: customer, error } = await supabase
      .from('customers')
      .select('id, phone, name, created_at')
      .eq('phone', phone)
      .single();

    if (error || !customer) throw new NotFoundError('Customer not found');

    const { data: orders } = await supabase
      .from('orders')
      .select('id, total')
      .eq('phone', phone);

    const orderCount = (orders || []).length;
    const totalSpend = (orders || []).reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);

    return {
      id: customer.id,
      phone: customer.phone,
      name: customer.name || null,
      createdAt: customer.created_at,
      orderCount,
      totalSpend,
    };
  }

  async getCustomerOrderHistory(phone: string, page: number = 1, limit: number = 20): Promise<{ orders: AdminOrderSummary[]; total: number }> {
    const offset = (page - 1) * limit;

    const { data, count, error } = await supabase
      .from('orders')
      .select('id, phone, total, status, payment_status, created_at, vendor_id, event_id', { count: 'exact' })
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Failed to fetch orders: ${error.message}`);

    const orderData = data || [];
    const vendorIds = [...new Set(orderData.map((o: any) => o.vendor_id).filter(Boolean))];
    const eventIds = [...new Set(orderData.map((o: any) => o.event_id).filter(Boolean))];

    const [vendorsRes, eventsRes] = await Promise.all([
      vendorIds.length > 0 ? supabase.from('vendors').select('id, name').in('id', vendorIds) : { data: [] },
      eventIds.length > 0 ? supabase.from('events').select('id, name').in('id', eventIds) : { data: [] },
    ]);

    const vendorMap = new Map((vendorsRes.data || []).map((v: any) => [v.id, v.name]));
    const eventMap = new Map((eventsRes.data || []).map((e: any) => [e.id, e.name]));

    return {
      orders: orderData.map((o: any) => ({
        id: o.id,
        customerPhone: o.phone || null,
        customerName: null,
        vendorId: o.vendor_id || null,
        vendorName: vendorMap.get(o.vendor_id) || null,
        eventId: o.event_id || null,
        total: Number(o.total) || 0,
        status: o.status,
        paymentStatus: o.payment_status || null,
        createdAt: o.created_at,
        eventName: eventMap.get(o.event_id) || null,
      })),
      total: count || 0,
    };
  }

  async overrideOrderStatus(orderId: string, newStatus: string, adminUserId: string, reason: string): Promise<void> {
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, status, phone, vendor_id')
      .eq('id', orderId)
      .single();

    if (fetchErr || !order) throw new NotFoundError('Order not found');

    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    if (error) throw new Error(`Failed to update order: ${error.message}`);

    await this.logAction(adminUserId, 'order_status_override', 'order', orderId, {
      previousStatus: order.status,
      newStatus,
      reason,
    });

    // Broadcast status update to admins
    broadcastToAdmins({
      type: 'ORDER_STATUS_UPDATE',
      payload: { orderId, status: newStatus, phone: order.phone, vendorId: order.vendor_id },
      timestamp: new Date().toISOString(),
    });
  }

  async adminRefundOrder(orderId: string, type: 'full' | 'partial', amount: number | undefined, reason: string, adminUserId: string): Promise<void> {
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchErr || !order) throw new NotFoundError('Order not found');

    const refundAmount = type === 'full' ? Number(order.total) : (amount || 0);

    const { error } = await supabase
      .from('orders')
      .update({
        status: 'REFUNDED',
        refund_status: 'refunded',
        refund_amount: refundAmount,
        refund_reason: reason,
        refunded_by: adminUserId,
        refunded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (error) throw new Error(`Failed to refund order: ${error.message}`);

    await this.logAction(adminUserId, 'order_refund', 'order', orderId, {
      type,
      amount: refundAmount,
      reason,
    });
  }

  async getReconciliationReport(startDate?: string, endDate?: string): Promise<ReconciliationReport> {
    let query = supabase
      .from('orders')
      .select('id, total, service_fee, vendor_id, event_id, payment_status, payment_method, status, refund_amount')
      .in('payment_status', ['complete', 'refunded', 'pay_at_stall']);

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', `${endDate}T23:59:59.999Z`);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch orders: ${error.message}`);

    const orders = data || [];

    // Get platform fee percentage from config
    const { data: configRow } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'platform_fee_percentage')
      .single();
    const platformFeePercent = Number(configRow?.value ?? 5) / 100;

    // Collect vendor/event IDs for name lookup
    const vendorIds = [...new Set(orders.map((o: any) => o.vendor_id).filter(Boolean))];
    const eventIds = [...new Set(orders.map((o: any) => o.event_id).filter(Boolean))];

    const [vendorsRes, eventsRes] = await Promise.all([
      vendorIds.length > 0 ? supabase.from('vendors').select('id, name').in('id', vendorIds) : { data: [] },
      eventIds.length > 0 ? supabase.from('events').select('id, name').in('id', eventIds) : { data: [] },
    ]);

    const vendorMap = new Map((vendorsRes.data || []).map((v: any) => [v.id, v.name]));
    const eventMap = new Map((eventsRes.data || []).map((e: any) => [e.id, e.name]));

    let totalGrossSales = 0;
    let totalServiceFees = 0;
    let totalRefunds = 0;
    const paymentMethodBreakdown: Record<string, { count: number; total: number }> = {};
    const vendorAgg: Record<string, any> = {};
    const eventAgg: Record<string, any> = {};

    for (const o of orders) {
      const amount = Number(o.total) || 0;
      const serviceFee = Number(o.service_fee) || 0;
      const refund = Number(o.refund_amount) || 0;
      const method = o.payment_method || 'unknown';

      totalGrossSales += amount;
      totalServiceFees += serviceFee;
      totalRefunds += refund;

      if (!paymentMethodBreakdown[method]) paymentMethodBreakdown[method] = { count: 0, total: 0 };
      paymentMethodBreakdown[method].count++;
      paymentMethodBreakdown[method].total += amount;

      // Vendor aggregation
      const vid = o.vendor_id;
      if (vid) {
        if (!vendorAgg[vid]) {
          vendorAgg[vid] = { vendorId: vid, vendorName: vendorMap.get(vid) || 'Unknown', grossSales: 0, serviceFee: 0, orderCount: 0, refundCount: 0, refundAmount: 0 };
        }
        vendorAgg[vid].grossSales += amount;
        vendorAgg[vid].serviceFee += serviceFee;
        vendorAgg[vid].orderCount++;
        if (refund > 0) { vendorAgg[vid].refundCount++; vendorAgg[vid].refundAmount += refund; }
      }

      // Event aggregation
      const eid = o.event_id;
      if (eid) {
        if (!eventAgg[eid]) {
          eventAgg[eid] = { eventId: eid, eventName: eventMap.get(eid) || 'Unknown', grossSales: 0, orderCount: 0, vendorIds: new Set() };
        }
        eventAgg[eid].grossSales += amount;
        eventAgg[eid].orderCount++;
        if (vid) eventAgg[eid].vendorIds.add(vid);
      }
    }

    const totalPlatformFees = totalGrossSales * platformFeePercent;
    const totalNetToVendors = totalGrossSales - totalServiceFees - totalPlatformFees;

    return {
      totalGrossSales,
      totalServiceFees,
      totalPlatformFees,
      totalNetToVendors,
      totalRefunds,
      paymentMethodBreakdown,
      byVendor: Object.values(vendorAgg).map((v: any) => ({
        ...v,
        platformFee: v.grossSales * platformFeePercent,
        netPayout: v.grossSales - v.serviceFee - (v.grossSales * platformFeePercent),
      })),
      byEvent: Object.values(eventAgg).map((e: any) => ({
        eventId: e.eventId,
        eventName: e.eventName,
        grossSales: e.grossSales,
        orderCount: e.orderCount,
        vendorCount: e.vendorIds.size,
      })),
    };
  }

  async getPeakHoursAnalysis(startDate?: string, endDate?: string, eventId?: string): Promise<PeakHoursAnalysis> {
    // Try server-side RPC first
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_peak_hours', {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_event_id: eventId || null,
      });

      if (!rpcError && rpcData) {
        const hourly = new Array(24).fill(null).map((_, h) => ({ hour: h, orderCount: 0, revenue: 0 }));
        for (const row of rpcData as any[]) {
          const h = Number(row.hour);
          hourly[h].orderCount = Number(row.order_count) || 0;
          hourly[h].revenue = Number(row.revenue) || 0;
        }
        const maxOrders = Math.max(...hourly.map(h => h.orderCount));
        const minOrders = Math.min(...hourly.map(h => h.orderCount));
        const peakHour = hourly.find(h => h.orderCount === maxOrders)?.hour ?? 0;
        const quietHour = hourly.find(h => h.orderCount === minOrders)?.hour ?? 0;
        return { hourlyDistribution: hourly, peakHour, quietHour };
      }
    } catch {
      // RPC not available yet — fall through
    }

    // Fallback: client-side aggregation with safety limit
    let query = supabase.from('orders').select('created_at, total').eq('payment_status', 'complete');
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', `${endDate}T23:59:59.999Z`);
    if (eventId) query = query.eq('event_id', eventId);

    const { data } = await query.limit(10000);
    const orders = data || [];

    const hourly = new Array(24).fill(null).map((_, h) => ({ hour: h, orderCount: 0, revenue: 0 }));
    for (const o of orders) {
      const hour = new Date(o.created_at).getHours();
      hourly[hour].orderCount++;
      hourly[hour].revenue += Number(o.total) || 0;
    }

    const maxOrders = Math.max(...hourly.map(h => h.orderCount));
    const minOrders = Math.min(...hourly.map(h => h.orderCount));
    const peakHour = hourly.find(h => h.orderCount === maxOrders)?.hour ?? 0;
    const quietHour = hourly.find(h => h.orderCount === minOrders)?.hour ?? 0;

    return { hourlyDistribution: hourly, peakHour, quietHour };
  }

  async getVendorPerformance(startDate?: string, endDate?: string, eventId?: string): Promise<VendorPerformance[]> {
    let query = supabase.from('orders').select('vendor_id, status, total, items, created_at, prepared_at, collected_at');
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', `${endDate}T23:59:59.999Z`);
    if (eventId) query = query.eq('event_id', eventId);

    const { data } = await query.limit(10000);
    const orders = data || [];

    const vendorIds = [...new Set(orders.map((o: any) => o.vendor_id).filter(Boolean))];
    const { data: vendors } = vendorIds.length > 0
      ? await supabase.from('vendors').select('id, name').in('id', vendorIds)
      : { data: [] };
    const vendorMap = new Map((vendors || []).map((v: any) => [v.id, v.name]));

    const agg: Record<string, any> = {};
    for (const o of orders) {
      const vid = o.vendor_id;
      if (!vid) continue;
      if (!agg[vid]) {
        agg[vid] = { vendorId: vid, vendorName: vendorMap.get(vid) || 'Unknown', totalOrders: 0, completedOrders: 0, cancelledOrders: 0, revenue: 0, prepTimes: [], totalTimes: [], itemCounts: {} };
      }
      agg[vid].totalOrders++;
      if (o.status === 'COLLECTED' || o.status === 'completed') { agg[vid].completedOrders++; agg[vid].revenue += Number(o.total) || 0; }
      if (o.status === 'CANCELLED') agg[vid].cancelledOrders++;
      if (o.prepared_at && o.created_at) {
        agg[vid].prepTimes.push((new Date(o.prepared_at).getTime() - new Date(o.created_at).getTime()) / 60000);
      }
      if (o.collected_at && o.created_at) {
        agg[vid].totalTimes.push((new Date(o.collected_at).getTime() - new Date(o.created_at).getTime()) / 60000);
      }
      if (Array.isArray(o.items)) {
        for (const item of o.items) {
          const name = item.name || item.menu_item_name || 'Unknown';
          agg[vid].itemCounts[name] = (agg[vid].itemCounts[name] || 0) + (item.quantity || 1);
        }
      }
    }

    return Object.values(agg).map((v: any) => ({
      vendorId: v.vendorId,
      vendorName: v.vendorName,
      totalOrders: v.totalOrders,
      completedOrders: v.completedOrders,
      cancelledOrders: v.cancelledOrders,
      completionRate: v.totalOrders > 0 ? (v.completedOrders / v.totalOrders) * 100 : 0,
      avgPrepTimeMinutes: v.prepTimes.length > 0 ? v.prepTimes.reduce((a: number, b: number) => a + b, 0) / v.prepTimes.length : 0,
      avgTotalTimeMinutes: v.totalTimes.length > 0 ? v.totalTimes.reduce((a: number, b: number) => a + b, 0) / v.totalTimes.length : 0,
      revenue: v.revenue,
      avgOrderValue: v.completedOrders > 0 ? v.revenue / v.completedOrders : 0,
      topItems: Object.entries(v.itemCounts)
        .sort((a: any, b: any) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, quantity]) => ({ name, quantity: quantity as number })),
    }));
  }

  async getPopularItems(startDate?: string, endDate?: string, eventId?: string, limit: number = 20): Promise<PopularItemsRanking> {
    let query = supabase.from('orders').select('items, total, vendor_id').eq('payment_status', 'complete');
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', `${endDate}T23:59:59.999Z`);
    if (eventId) query = query.eq('event_id', eventId);

    const { data } = await query;
    const orders = data || [];

    const vendorIds = [...new Set(orders.map((o: any) => o.vendor_id).filter(Boolean))];
    const { data: vendors } = vendorIds.length > 0
      ? await supabase.from('vendors').select('id, name').in('id', vendorIds)
      : { data: [] };
    const vendorMap = new Map((vendors || []).map((v: any) => [v.id, v.name]));

    const itemAgg: Record<string, { name: string; totalQuantity: number; totalRevenue: number; vendorName: string; orderCount: number }> = {};
    for (const o of orders) {
      if (!Array.isArray(o.items)) continue;
      const vName = vendorMap.get(o.vendor_id) || 'Unknown';
      for (const item of o.items) {
        const name = item.name || item.menu_item_name || 'Unknown';
        const key = `${name}__${o.vendor_id}`;
        if (!itemAgg[key]) itemAgg[key] = { name, totalQuantity: 0, totalRevenue: 0, vendorName: vName, orderCount: 0 };
        itemAgg[key].totalQuantity += item.quantity || 1;
        itemAgg[key].totalRevenue += (Number(item.price || item.unit_price || 0)) * (item.quantity || 1);
        itemAgg[key].orderCount++;
      }
    }

    const items = Object.values(itemAgg)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, limit);

    return { items };
  }

  async getConversionFunnel(startDate?: string, endDate?: string, eventId?: string): Promise<ConversionFunnel> {
    let baseQuery = supabase.from('orders').select('id, status, payment_status, stitch_payment_id', { count: 'exact' });
    if (startDate) baseQuery = baseQuery.gte('created_at', startDate);
    if (endDate) baseQuery = baseQuery.lte('created_at', `${endDate}T23:59:59.999Z`);
    if (eventId) baseQuery = baseQuery.eq('event_id', eventId);

    const { data } = await baseQuery;
    const orders = data || [];

    const paymentInitiated = orders.filter((o: any) => o.stitch_payment_id).length;
    const paymentCompleted = orders.filter((o: any) => o.payment_status === 'complete').length;
    const orderCollected = orders.filter((o: any) => o.status === 'COLLECTED' || o.status === 'completed').length;
    const orderCancelled = orders.filter((o: any) => o.status === 'CANCELLED').length;

    return { paymentInitiated, paymentCompleted, orderCollected, orderCancelled };
  }

  async getActiveAlerts(): Promise<Alert[]> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();

    const alerts: Alert[] = [];

    // Check for acknowledged alerts in Redis
    const ackedSet = await cache.get<string[]>('admin:acked_alerts') || [];
    const isAcked = (id: string) => ackedSet.includes(id);

    // Failed payments in last hour
    const { data: failedPayments } = await supabase
      .from('orders')
      .select('id, phone, total, payment_status, created_at')
      .in('payment_status', ['cancelled', 'expired', 'failed'])
      .gte('created_at', oneHourAgo)
      .limit(20);

    for (const fp of (failedPayments || [])) {
      const alertId = `failed_payment_${fp.id}`;
      alerts.push({
        id: alertId,
        type: 'failed_payment',
        severity: 'critical',
        title: `Payment ${fp.payment_status}: #${fp.id.slice(0, 8)}`,
        description: `Order ${fp.id.slice(0, 8)} (R${Number(fp.total || 0).toFixed(2)}) payment ${fp.payment_status}`,
        resourceId: fp.id,
        resourceType: 'order',
        createdAt: fp.created_at,
        acknowledged: isAcked(alertId),
      });
    }

    // Stale orders (PENDING > 15min)
    const { data: staleOrders } = await supabase
      .from('orders')
      .select('id, phone, vendor_id, created_at')
      .eq('status', 'PENDING')
      .lt('created_at', fifteenMinAgo)
      .limit(20);

    for (const so of (staleOrders || [])) {
      const alertId = `stale_order_${so.id}`;
      const age = Math.round((now.getTime() - new Date(so.created_at).getTime()) / 60000);
      alerts.push({
        id: alertId,
        type: 'stale_order',
        severity: 'warning',
        title: `Stale order: #${so.id.slice(0, 8)} (${age}min)`,
        description: `Order has been PENDING for ${age} minutes`,
        resourceId: so.id,
        resourceType: 'order',
        createdAt: so.created_at,
        acknowledged: isAcked(alertId),
      });
    }

    return alerts.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return (severityOrder[a.severity] - severityOrder[b.severity]) || (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });
  }

  async acknowledgeAlert(alertId: string): Promise<void> {
    const ackedSet = await cache.get<string[]>('admin:acked_alerts') || [];
    if (!ackedSet.includes(alertId)) {
      ackedSet.push(alertId);
      await cache.set('admin:acked_alerts', ackedSet, 86400); // 24h TTL
    }
  }

  async getSystemHealth(): Promise<SystemHealth> {
    // Redis latency
    let redisStatus = 'healthy';
    let redisLatency = 0;
    try {
      const start = Date.now();
      await redis.ping();
      redisLatency = Date.now() - start;
    } catch {
      redisStatus = 'unhealthy';
      redisLatency = -1;
    }

    // Database latency
    let dbStatus = 'healthy';
    let dbLatency = 0;
    try {
      const start = Date.now();
      await supabase.from('platform_config').select('key').limit(1);
      dbLatency = Date.now() - start;
    } catch {
      dbStatus = 'unhealthy';
      dbLatency = -1;
    }

    const wsStats = getConnectionStats();
    const mem = process.memoryUsage();

    // Import recent errors from index.ts
    let recentErrors: any[] = [];
    try {
      const { getRecentErrors } = await import('../index.js');
      recentErrors = getRecentErrors();
    } catch {
      // ignore if import fails
    }

    return {
      api: {
        status: 'healthy',
        uptime: process.uptime(),
        memoryUsage: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
      },
      redis: { status: redisStatus, latencyMs: redisLatency },
      database: { status: dbStatus, latencyMs: dbLatency },
      websocket: { totalConnections: wsStats.totalConnections },
      recentErrors: recentErrors.slice(0, 50),
    };
  }

  async getStakeholderStats(): Promise<StakeholderStats> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // --- Customer stats ---
    const [
      totalCustomers,
      newCustomers7d,
      newCustomers30d,
      allOrders,
    ] = await Promise.all([
      supabase.from('customers').select('id', { count: 'exact', head: true }),
      supabase.from('customers').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
      supabase.from('customers').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),
      supabase.from('orders').select('phone, total, created_at'),
    ]);

    const orders = allOrders.data || [];
    const ordersByPhone = new Map<string, { count: number; total: number; lastOrder: string }>();
    for (const o of orders) {
      const phone = o.phone;
      if (!phone) continue;
      const existing = ordersByPhone.get(phone) || { count: 0, total: 0, lastOrder: '' };
      existing.count++;
      existing.total += Number(o.total) || 0;
      if (o.created_at > existing.lastOrder) existing.lastOrder = o.created_at;
      ordersByPhone.set(phone, existing);
    }

    const customersWithOrders = ordersByPhone.size;
    const repeatCustomers = Array.from(ordersByPhone.values()).filter(c => c.count > 1).length;
    const active30dCustomers = Array.from(ordersByPhone.entries()).filter(([_, c]) => c.lastOrder >= thirtyDaysAgo).length;
    const totalCustomerSpend = Array.from(ordersByPhone.values()).reduce((sum, c) => sum + c.total, 0);

    // --- Vendor stats ---
    const [
      totalVendors,
      activeVendors,
      totalMenuItems,
      vendorOrders,
    ] = await Promise.all([
      supabase.from('vendor_users').select('id', { count: 'exact', head: true }),
      supabase.from('vendor_users').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('menu_items').select('id', { count: 'exact', head: true }),
      supabase.from('orders').select('vendor_id, total, status'),
    ]);

    const vendorAgg = new Map<string, { orders: number; revenue: number }>();
    for (const o of (vendorOrders.data || [])) {
      if (!o.vendor_id) continue;
      const existing = vendorAgg.get(o.vendor_id) || { orders: 0, revenue: 0 };
      existing.orders++;
      if (o.status === 'COLLECTED' || o.status === 'completed') {
        existing.revenue += Number(o.total) || 0;
      }
      vendorAgg.set(o.vendor_id, existing);
    }

    // Get vendor names for top performers
    const vendorEntries = Array.from(vendorAgg.entries()).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
    const topVendorIds = vendorEntries.map(([id]) => id);
    const { data: vendorNames } = topVendorIds.length > 0
      ? await supabase.from('vendors').select('id, name').in('id', topVendorIds)
      : { data: [] };
    const vendorNameMap = new Map((vendorNames || []).map((v: any) => [v.id, v.name]));

    const vendorsWithOrders = vendorAgg.size;
    const totalVendorRevenue = Array.from(vendorAgg.values()).reduce((sum, v) => sum + v.revenue, 0);
    const totalVendorOrders = Array.from(vendorAgg.values()).reduce((sum, v) => sum + v.orders, 0);

    // --- Organizer stats ---
    const [
      totalOrganizers,
      totalEvents,
      activeEvents,
      eventsByOrganizer,
    ] = await Promise.all([
      supabase.from('organizer_users').select('id', { count: 'exact', head: true }),
      supabase.from('events').select('id', { count: 'exact', head: true }),
      supabase.from('events').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('events').select('organizer_id, id, name'),
    ]);

    const orgAgg = new Map<string, number>();
    for (const e of (eventsByOrganizer.data || [])) {
      if (!e.organizer_id) continue;
      orgAgg.set(e.organizer_id, (orgAgg.get(e.organizer_id) || 0) + 1);
    }

    const topOrgEntries = Array.from(orgAgg.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topOrgIds = topOrgEntries.map(([id]) => id);
    const { data: orgNames } = topOrgIds.length > 0
      ? await supabase.from('organizer_users').select('id, name').in('id', topOrgIds)
      : { data: [] };
    const orgNameMap = new Map((orgNames || []).map((o: any) => [o.id, o.name]));

    const orgCount = totalOrganizers.count || 1;

    return {
      customers: {
        total: totalCustomers.count || 0,
        active30d: active30dCustomers,
        repeatRate: customersWithOrders > 0 ? (repeatCustomers / customersWithOrders) * 100 : 0,
        avgSpend: customersWithOrders > 0 ? totalCustomerSpend / customersWithOrders : 0,
        totalSpend: totalCustomerSpend,
        newLast7d: newCustomers7d.count || 0,
        newLast30d: newCustomers30d.count || 0,
      },
      vendors: {
        total: totalVendors.count || 0,
        active: activeVendors.count || 0,
        avgOrdersPerVendor: vendorsWithOrders > 0 ? totalVendorOrders / vendorsWithOrders : 0,
        avgRevenuePerVendor: vendorsWithOrders > 0 ? totalVendorRevenue / vendorsWithOrders : 0,
        totalMenuItems: totalMenuItems.count || 0,
        topPerformers: vendorEntries.map(([id, data]) => ({
          id,
          name: vendorNameMap.get(id) || 'Unknown',
          orders: data.orders,
          revenue: data.revenue,
        })),
      },
      organizers: {
        total: totalOrganizers.count || 0,
        totalEventsCreated: totalEvents.count || 0,
        activeEvents: activeEvents.count || 0,
        avgEventsPerOrganizer: (totalEvents.count || 0) / orgCount,
        topOrganizers: topOrgEntries.map(([id, events]) => ({
          id,
          name: orgNameMap.get(id) || 'Unknown',
          events,
        })),
      },
    };
  }

  async getUserDetail(type: string, id: string): Promise<UserDetail> {
    const table = USER_TABLES[type];
    if (!table) throw new ValidationError(`Invalid user type: ${type}`);

    const { data: user, error } = await supabase
      .from(table)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !user) throw new NotFoundError('User not found');

    if (type === 'vendor') {
      // Get linked vendor entity and order stats
      const { data: vendor } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('user_id', id)
        .single();

      let orderCount = 0;
      let totalRevenue = 0;
      if (vendor) {
        const { data: orders } = await supabase
          .from('orders')
          .select('id, total')
          .eq('vendor_id', vendor.id);
        orderCount = (orders || []).length;
        totalRevenue = (orders || []).reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name || '',
        vendorId: vendor?.id || null,
        vendorName: vendor?.name || null,
        isActive: user.is_active !== false,
        createdAt: user.created_at,
        orderCount,
        totalRevenue,
      } as VendorUserDetail;
    }

    if (type === 'organizer') {
      const { count: eventCount } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('organizer_id', id);

      const { count: activeEventCount } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('organizer_id', id)
        .eq('is_active', true);

      return {
        id: user.id,
        email: user.email,
        name: user.name || '',
        phone: user.phone || null,
        organization: user.organization || null,
        isActive: user.is_active !== false,
        createdAt: user.created_at,
        eventCount: eventCount || 0,
        activeEventCount: activeEventCount || 0,
      } as OrganizerUserDetail;
    }

    // customer
    const { data: orders } = await supabase
      .from('orders')
      .select('id, total')
      .eq('phone', user.phone);

    return {
      id: user.id,
      phone: user.phone,
      name: user.name || null,
      isActive: user.is_active !== false,
      createdAt: user.created_at,
      orderCount: (orders || []).length,
      totalSpend: (orders || []).reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0),
    } as CustomerDetail;
  }

  async updateUser(type: string, id: string, payload: Record<string, unknown>): Promise<void> {
    const table = USER_TABLES[type];
    if (!table) throw new ValidationError(`Invalid user type: ${type}`);

    const { data: existing, error: fetchErr } = await supabase
      .from(table)
      .select('id')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) throw new NotFoundError('User not found');

    // Build update object based on type, only allowing valid fields
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (type === 'vendor') {
      if (payload.email !== undefined) update.email = payload.email;
      if (payload.name !== undefined) update.name = payload.name;
    } else if (type === 'organizer') {
      if (payload.name !== undefined) update.name = payload.name;
      if (payload.email !== undefined) update.email = payload.email;
      if (payload.phone !== undefined) update.phone = payload.phone;
      if (payload.organization !== undefined) update.organization = payload.organization;
    } else {
      // customer
      if (payload.name !== undefined) update.name = payload.name;
      if (payload.phone !== undefined) update.phone = payload.phone;
    }

    const { error } = await supabase
      .from(table)
      .update(update)
      .eq('id', id);

    if (error) throw new Error(`Failed to update user: ${error.message}`);
  }

  async deleteUser(type: string, id: string): Promise<void> {
    const table = USER_TABLES[type];
    if (!table) throw new ValidationError(`Invalid user type: ${type}`);

    const { data: existing, error: fetchErr } = await supabase
      .from(table)
      .select('id')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) throw new NotFoundError('User not found');

    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete user: ${error.message}`);
  }

  async inviteUser(type: string, payload: { email: string; vendorId?: string }): Promise<{ inviteToken: string; expiresAt: string }> {
    if (type === 'vendor') {
      if (!payload.vendorId) throw new ValidationError('vendorId is required for vendor invites');
      const authService = new AuthService();
      return authService.createInvite({ vendorId: payload.vendorId, email: payload.email });
    }
    if (type === 'organizer') {
      const orgAuthService = new OrganizerAuthService();
      return orgAuthService.createInvite({ email: payload.email });
    }
    throw new ValidationError('Invites are only supported for vendor and organizer users');
  }

  async sendResetLink(type: string, id: string): Promise<{ token: string; resetUrl: string }> {
    if (type !== 'vendor' && type !== 'organizer') {
      throw new ValidationError('Password reset is only supported for vendor and organizer users');
    }

    const table = USER_TABLES[type];
    const { data: user, error } = await supabase
      .from(table!)
      .select('id, email')
      .eq('id', id)
      .single();

    if (error || !user) throw new NotFoundError('User not found');

    let token: string;
    if (type === 'vendor') {
      const authService = new AuthService();
      const result = await authService.createPasswordReset(user.email);
      token = result.token;
    } else {
      const orgAuthService = new OrganizerAuthService();
      const result = await orgAuthService.createPasswordReset(user.email);
      token = result.token;
    }

    const baseUrl = type === 'vendor'
      ? (process.env.VENDOR_APP_URL || 'http://localhost:3001')
      : (process.env.ORGANIZER_APP_URL || 'http://localhost:3003');
    const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;

    return { token, resetUrl };
  }
}
