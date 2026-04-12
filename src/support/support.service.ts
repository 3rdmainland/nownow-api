import { supabase } from '../lib/supabase.js';
import { NotFoundError } from '../lib/errors.js';
import { cache } from '../lib/redis.js';
import { AdminService } from '../admin/admin.service.js';
import { sendEmail } from '../lib/email.js';
import { ticketFromDb, messageFromDb } from './support.utils.js';
import { broadcastTicketUpdate } from '../websocket/websocket.controller.js';
import {
  SupportTicket,
  SupportMessage,
  SupportTicketWithMessages,
  CreateTicketPayload,
  CreateGuestTicketPayload,
  UpdateTicketPayload,
  AddMessagePayload,
  TicketListParams,
  TicketListResponse,
  SupportStats,
  SenderType,
} from './support.types.js';

const STATS_CACHE_KEY = 'support:stats';
const STATS_TTL = 60;

export class SupportService {
  private adminService = new AdminService();

  async listTickets(params: TicketListParams): Promise<TicketListResponse> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('support_tickets')
      .select('*, admin_users!support_tickets_assigned_admin_id_fkey(name)', { count: 'exact' });

    if (params.status) query = query.eq('status', params.status);
    if (params.priority) query = query.eq('priority', params.priority);
    if (params.category) query = query.eq('category', params.category);
    if (params.assignedAdminId) query = query.eq('assigned_admin_id', params.assignedAdminId);
    if (params.search) {
      query = query.or(`subject.ilike.%${params.search}%,description.ilike.%${params.search}%,customer_phone.ilike.%${params.search}%`);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return {
      tickets: (data || []).map(ticketFromDb),
      total: count || 0,
      page,
      limit,
    };
  }

  async getTicketById(id: string): Promise<SupportTicketWithMessages> {
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .select('*, admin_users!support_tickets_assigned_admin_id_fkey(name)')
      .eq('id', id)
      .single();

    if (ticketError || !ticket) throw new NotFoundError('Ticket not found');

    const { data: messages, error: messagesError } = await supabase
      .from('support_messages')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });

    if (messagesError) throw messagesError;

    return {
      ...ticketFromDb(ticket),
      messages: (messages || []).map(messageFromDb),
    };
  }

  async createTicket(payload: CreateTicketPayload, adminUserId: string): Promise<SupportTicket> {
    const { data, error } = await supabase
      .from('support_tickets')
      .insert([{
        subject: payload.subject,
        description: payload.description,
        category: payload.category,
        priority: payload.priority || 'MEDIUM',
        source: payload.source || 'ADMIN',
        customer_phone: payload.customerPhone || null,
        order_id: payload.orderId || null,
        event_id: payload.eventId || null,
        vendor_id: payload.vendorId || null,
      }])
      .select('*, admin_users!support_tickets_assigned_admin_id_fkey(name)')
      .single();

    if (error) throw error;

    // Add system message
    await supabase.from('support_messages').insert([{
      ticket_id: data.id,
      sender_type: 'SYSTEM',
      message: 'Ticket created',
    }]);

    // Audit log
    await this.adminService.logAction(adminUserId, 'ticket_created', 'support_ticket', data.id, {
      subject: payload.subject,
      category: payload.category,
    });

    await cache.del(STATS_CACHE_KEY);

    return ticketFromDb(data);
  }

  async updateTicket(id: string, payload: UpdateTicketPayload, adminUserId: string): Promise<SupportTicket> {
    // Verify ticket exists
    const { data: existing, error: existErr } = await supabase
      .from('support_tickets')
      .select('id, status, priority, assigned_admin_id')
      .eq('id', id)
      .single();

    if (existErr || !existing) throw new NotFoundError('Ticket not found');

    const updateFields: Record<string, any> = { updated_at: new Date().toISOString() };
    if (payload.subject !== undefined) updateFields.subject = payload.subject;
    if (payload.description !== undefined) updateFields.description = payload.description;
    if (payload.category !== undefined) updateFields.category = payload.category;
    if (payload.priority !== undefined) updateFields.priority = payload.priority;
    if (payload.status !== undefined) updateFields.status = payload.status;
    if (payload.assignedAdminId !== undefined) updateFields.assigned_admin_id = payload.assignedAdminId;

    const { data, error } = await supabase
      .from('support_tickets')
      .update(updateFields)
      .eq('id', id)
      .select('*, admin_users!support_tickets_assigned_admin_id_fkey(name)')
      .single();

    if (error) throw error;

    // System messages for notable changes
    const systemMessages: string[] = [];
    if (payload.status && payload.status !== existing.status) {
      systemMessages.push(`Status changed from ${existing.status} to ${payload.status}`);
    }
    if (payload.priority && payload.priority !== existing.priority) {
      systemMessages.push(`Priority changed from ${existing.priority} to ${payload.priority}`);
    }
    if (payload.assignedAdminId !== undefined && payload.assignedAdminId !== existing.assigned_admin_id) {
      if (payload.assignedAdminId) {
        // Look up admin name
        const { data: admin } = await supabase.from('admin_users').select('name').eq('id', payload.assignedAdminId).single();
        systemMessages.push(`Assigned to ${admin?.name || 'admin'}`);
      } else {
        systemMessages.push('Unassigned');
      }
    }

    for (const msg of systemMessages) {
      await supabase.from('support_messages').insert([{
        ticket_id: id,
        sender_type: 'SYSTEM',
        message: msg,
      }]);
    }

    await this.adminService.logAction(adminUserId, 'ticket_updated', 'support_ticket', id, payload as Record<string, unknown>);
    await cache.del(STATS_CACHE_KEY);

    const ticket = ticketFromDb(data);
    broadcastTicketUpdate({
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      action: 'updated',
      customerPhone: ticket.customerPhone,
      status: ticket.status,
      subject: ticket.subject,
    });

    return ticket;
  }

  async addMessage(
    ticketId: string,
    payload: AddMessagePayload,
    senderType: SenderType,
    senderId: string,
    senderName: string
  ): Promise<SupportMessage> {
    // Verify ticket exists
    const { data: ticket, error: ticketErr } = await supabase
      .from('support_tickets')
      .select('id, status, customer_phone, ticket_number, subject')
      .eq('id', ticketId)
      .single();

    if (ticketErr || !ticket) throw new NotFoundError('Ticket not found');

    const { data, error } = await supabase
      .from('support_messages')
      .insert([{
        ticket_id: ticketId,
        sender_type: senderType,
        sender_id: senderId,
        sender_name: senderName,
        message: payload.message,
        is_internal: payload.isInternal || false,
      }])
      .select()
      .single();

    if (error) throw error;

    // Auto-transition OPEN → IN_PROGRESS on first admin reply
    if (senderType === 'ADMIN' && ticket.status === 'OPEN') {
      await supabase
        .from('support_tickets')
        .update({ status: 'IN_PROGRESS', updated_at: new Date().toISOString() })
        .eq('id', ticketId);

      await supabase.from('support_messages').insert([{
        ticket_id: ticketId,
        sender_type: 'SYSTEM',
        message: 'Status changed from OPEN to IN_PROGRESS',
      }]);

      await cache.del(STATS_CACHE_KEY);
    }

    // Broadcast to customer + admins (skip internal admin notes)
    if (!payload.isInternal) {
      broadcastTicketUpdate({
        ticketId,
        ticketNumber: ticket.ticket_number,
        action: 'message',
        customerPhone: ticket.customer_phone,
        status: ticket.status,
        subject: ticket.subject,
      });
    }

    return messageFromDb(data);
  }

  async resolveTicket(id: string, message: string, adminUserId: string): Promise<SupportTicket> {
    const { data: existing, error: existErr } = await supabase
      .from('support_tickets')
      .select('id')
      .eq('id', id)
      .single();

    if (existErr || !existing) throw new NotFoundError('Ticket not found');

    const now = new Date().toISOString();

    // Get admin name
    const { data: admin } = await supabase.from('admin_users').select('name').eq('id', adminUserId).single();

    // Add resolution message
    await supabase.from('support_messages').insert([{
      ticket_id: id,
      sender_type: 'ADMIN',
      sender_id: adminUserId,
      sender_name: admin?.name || 'Admin',
      message,
    }]);

    // Add system message
    await supabase.from('support_messages').insert([{
      ticket_id: id,
      sender_type: 'SYSTEM',
      message: 'Ticket resolved',
    }]);

    const { data, error } = await supabase
      .from('support_tickets')
      .update({ status: 'RESOLVED', resolved_at: now, updated_at: now })
      .eq('id', id)
      .select('*, admin_users!support_tickets_assigned_admin_id_fkey(name)')
      .single();

    if (error) throw error;

    await this.adminService.logAction(adminUserId, 'ticket_resolved', 'support_ticket', id, null);
    await cache.del(STATS_CACHE_KEY);

    const ticket = ticketFromDb(data);
    broadcastTicketUpdate({
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      action: 'updated',
      customerPhone: ticket.customerPhone,
      status: 'RESOLVED',
      subject: ticket.subject,
    });

    // Email resolution to customer
    if (ticket.customerPhone) {
      const { data: customer } = await supabase.from('customers').select('email, name').eq('phone', ticket.customerPhone).single();
      if (customer?.email) {
        void sendEmail({
          to: customer.email,
          subject: `Ticket #${ticket.ticketNumber} Resolved`,
          html: `
            <h2>Your ticket has been resolved</h2>
            <p>Hi ${customer.name || 'there'},</p>
            <p>Your support ticket <strong>#${ticket.ticketNumber}</strong> has been resolved.</p>
            <p><strong>Resolution:</strong> ${message}</p>
            <p>If you still need help, you can open a new ticket.</p>
          `,
        }).catch(err => console.error('Failed to send resolution email:', err?.message || err));
      }
    }

    return ticket;
  }

  async closeTicket(id: string, adminUserId: string): Promise<SupportTicket> {
    const { data: existing, error: existErr } = await supabase
      .from('support_tickets')
      .select('id')
      .eq('id', id)
      .single();

    if (existErr || !existing) throw new NotFoundError('Ticket not found');

    const now = new Date().toISOString();

    await supabase.from('support_messages').insert([{
      ticket_id: id,
      sender_type: 'SYSTEM',
      message: 'Ticket closed',
    }]);

    const { data, error } = await supabase
      .from('support_tickets')
      .update({ status: 'CLOSED', closed_at: now, updated_at: now })
      .eq('id', id)
      .select('*, admin_users!support_tickets_assigned_admin_id_fkey(name)')
      .single();

    if (error) throw error;

    await this.adminService.logAction(adminUserId, 'ticket_closed', 'support_ticket', id, null);
    await cache.del(STATS_CACHE_KEY);

    const ticket = ticketFromDb(data);
    broadcastTicketUpdate({
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      action: 'updated',
      customerPhone: ticket.customerPhone,
      status: 'CLOSED',
      subject: ticket.subject,
    });

    return ticket;
  }

  // ── Customer-facing methods ──

  async createCustomerTicket(
    payload: CreateTicketPayload,
    customerId: string,
    customerPhone: string
  ): Promise<SupportTicket> {
    const { data, error } = await supabase
      .from('support_tickets')
      .insert([{
        subject: payload.subject,
        description: payload.description,
        category: payload.category,
        priority: payload.priority || 'MEDIUM',
        source: 'CUSTOMER' as const,
        customer_phone: customerPhone,
        order_id: payload.orderId || null,
        event_id: payload.eventId || null,
        vendor_id: payload.vendorId || null,
      }])
      .select('*, admin_users!support_tickets_assigned_admin_id_fkey(name)')
      .single();

    if (error) throw error;

    await supabase.from('support_messages').insert([{
      ticket_id: data.id,
      sender_type: 'SYSTEM',
      message: 'Ticket created by customer',
    }]);

    await cache.del(STATS_CACHE_KEY);

    const ticket = ticketFromDb(data);
    broadcastTicketUpdate({
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      action: 'created',
      customerPhone: customerPhone,
      status: ticket.status,
      subject: ticket.subject,
    });

    // Email ticket confirmation to customer
    if (customerId) {
      const { data: customer } = await supabase.from('customers').select('email, name').eq('id', customerId).single();
      if (customer?.email) {
        void sendEmail({
          to: customer.email,
          subject: `Support Ticket #${ticket.ticketNumber} — ${ticket.subject}`,
          html: `
            <h2>We've received your request</h2>
            <p>Hi ${customer.name || 'there'},</p>
            <p>Your support ticket has been created.</p>
            <p><strong>Ticket #:</strong> ${ticket.ticketNumber}</p>
            <p><strong>Subject:</strong> ${ticket.subject}</p>
            <p>We'll get back to you as soon as possible.</p>
          `,
        }).catch(err => console.error('Failed to send ticket confirmation email:', err?.message || err));
      }
    }

    return ticket;
  }

  async createGuestTicket(payload: CreateGuestTicketPayload): Promise<SupportTicket> {
    const { data, error } = await supabase
      .from('support_tickets')
      .insert([{
        subject: payload.subject,
        description: payload.description,
        category: payload.category,
        priority: payload.priority || 'MEDIUM',
        source: 'GUEST' as const,
        customer_phone: null,
        order_id: null,
        event_id: payload.eventId || null,
        vendor_id: null,
      }])
      .select('*, admin_users!support_tickets_assigned_admin_id_fkey(name)')
      .single();

    if (error) throw error;

    await supabase.from('support_messages').insert([{
      ticket_id: data.id,
      sender_type: 'SYSTEM',
      message: 'Ticket created by guest (unauthenticated)',
    }]);

    await cache.del(STATS_CACHE_KEY);

    const ticket = ticketFromDb(data);
    broadcastTicketUpdate({
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      action: 'created',
      customerPhone: null,
      status: ticket.status,
      subject: ticket.subject,
    });

    return ticket;
  }

  async listTicketsByPhone(phone: string): Promise<SupportTicket[]> {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*, admin_users!support_tickets_assigned_admin_id_fkey(name)')
      .eq('customer_phone', phone)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(ticketFromDb);
  }

  async getTicketByIdForCustomer(id: string, phone: string): Promise<SupportTicketWithMessages> {
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .select('*, admin_users!support_tickets_assigned_admin_id_fkey(name)')
      .eq('id', id)
      .eq('customer_phone', phone)
      .single();

    if (ticketError || !ticket) throw new NotFoundError('Ticket not found');

    const { data: messages, error: messagesError } = await supabase
      .from('support_messages')
      .select('*')
      .eq('ticket_id', id)
      .eq('is_internal', false)
      .order('created_at', { ascending: true });

    if (messagesError) throw messagesError;

    return {
      ...ticketFromDb(ticket),
      messages: (messages || []).map(messageFromDb),
    };
  }

  async addCustomerMessage(ticketId: string, phone: string, message: string): Promise<SupportMessage> {
    const { data: ticket, error: ticketErr } = await supabase
      .from('support_tickets')
      .select('id, status, ticket_number, subject')
      .eq('id', ticketId)
      .eq('customer_phone', phone)
      .single();

    if (ticketErr || !ticket) throw new NotFoundError('Ticket not found');

    const { data, error } = await supabase
      .from('support_messages')
      .insert([{
        ticket_id: ticketId,
        sender_type: 'CUSTOMER',
        sender_name: phone,
        message,
        is_internal: false,
      }])
      .select()
      .single();

    if (error) throw error;

    broadcastTicketUpdate({
      ticketId,
      ticketNumber: ticket.ticket_number,
      action: 'message',
      customerPhone: phone,
      status: ticket.status,
      subject: ticket.subject,
    });

    return messageFromDb(data);
  }

  async getStats(): Promise<SupportStats> {
    const cached = await cache.get<SupportStats>(STATS_CACHE_KEY);
    if (cached) return cached;

    const { data: tickets, error } = await supabase
      .from('support_tickets')
      .select('status, priority, category, assigned_admin_id, created_at, resolved_at');

    if (error) throw error;

    const all = tickets || [];

    const open = all.filter(t => t.status === 'OPEN').length;
    const inProgress = all.filter(t => t.status === 'IN_PROGRESS').length;
    const resolved = all.filter(t => t.status === 'RESOLVED').length;
    const closed = all.filter(t => t.status === 'CLOSED').length;
    const unassigned = all.filter(t => !t.assigned_admin_id && (t.status === 'OPEN' || t.status === 'IN_PROGRESS')).length;
    const urgent = all.filter(t => t.priority === 'URGENT' && (t.status === 'OPEN' || t.status === 'IN_PROGRESS')).length;

    // Average resolution time for resolved/closed tickets
    const resolvedTickets = all.filter(t => t.resolved_at);
    let avgResolutionHours: number | null = null;
    if (resolvedTickets.length > 0) {
      const totalHours = resolvedTickets.reduce((sum, t) => {
        const created = new Date(t.created_at).getTime();
        const resolved = new Date(t.resolved_at).getTime();
        return sum + (resolved - created) / (1000 * 60 * 60);
      }, 0);
      avgResolutionHours = Math.round((totalHours / resolvedTickets.length) * 10) / 10;
    }

    const byCategory: Record<string, number> = {};
    for (const t of all) {
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    }

    const stats: SupportStats = {
      open,
      inProgress,
      resolved,
      closed,
      unassigned,
      urgent,
      avgResolutionHours,
      byCategory,
    };

    await cache.set(STATS_CACHE_KEY, stats, STATS_TTL);
    return stats;
  }
}
