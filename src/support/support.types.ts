export type TicketCategory = 'ORDER_ISSUE' | 'ACCOUNT_ISSUE' | 'PAYMENT_ISSUE' | 'GENERAL_INQUIRY' | 'VENDOR_COMPLAINT' | 'EVENT_ISSUE';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketSource = 'CUSTOMER' | 'VENDOR' | 'ADMIN';
export type SenderType = 'ADMIN' | 'CUSTOMER' | 'SYSTEM';

export interface SupportTicket {
  id: string;
  ticketNumber: number;
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  source: TicketSource;
  customerPhone: string | null;
  orderId: string | null;
  eventId: string | null;
  vendorId: string | null;
  assignedAdminId: string | null;
  assignedAdminName: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessage {
  id: string;
  ticketId: string;
  senderType: SenderType;
  senderId: string | null;
  senderName: string | null;
  message: string;
  isInternal: boolean;
  createdAt: string;
}

export interface SupportTicketWithMessages extends SupportTicket {
  messages: SupportMessage[];
}

export interface CreateTicketPayload {
  subject: string;
  description: string;
  category: TicketCategory;
  priority?: TicketPriority;
  source?: TicketSource;
  customerPhone?: string;
  orderId?: string;
  eventId?: string;
  vendorId?: string;
}

export interface UpdateTicketPayload {
  subject?: string;
  description?: string;
  category?: TicketCategory;
  priority?: TicketPriority;
  status?: TicketStatus;
  assignedAdminId?: string | null;
}

export interface AddMessagePayload {
  message: string;
  isInternal?: boolean;
}

export interface TicketListParams {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  assignedAdminId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface TicketListResponse {
  tickets: SupportTicket[];
  total: number;
  page: number;
  limit: number;
}

export interface SupportStats {
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  unassigned: number;
  urgent: number;
  avgResolutionHours: number | null;
  byCategory: Record<string, number>;
}
