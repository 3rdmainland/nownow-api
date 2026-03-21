import { SupportTicket, SupportMessage } from './support.types.js';

export function ticketFromDb(row: any): SupportTicket {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    subject: row.subject,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    source: row.source,
    customerPhone: row.customer_phone,
    orderId: row.order_id,
    eventId: row.event_id,
    vendorId: row.vendor_id,
    assignedAdminId: row.assigned_admin_id,
    assignedAdminName: row.admin_users?.name ?? row.assigned_admin_name ?? null,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function messageFromDb(row: any): SupportMessage {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    senderName: row.sender_name,
    message: row.message,
    isInternal: row.is_internal ?? false,
    createdAt: row.created_at,
  };
}
