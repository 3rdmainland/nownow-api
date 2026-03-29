import type { NotificationType } from '../notifications/notifications.types.js';

/**
 * WebSocket event types for real-time updates
 */

export type WebSocketEventType =
  | 'PRICE_UPDATE'
  | 'MENU_ITEM_UPDATE'
  | 'ITEM_AVAILABILITY_UPDATE'
  | 'VENDOR_STATUS_UPDATE'
  | 'ORDER_STATUS_UPDATE'
  | 'NEW_ORDER'
  | 'ADMIN_ORDER_FEED'
  | 'PAYMENT_FAILED'
  | 'TICKET_UPDATE'
  | 'NOTIFICATION'
  | 'QR_READY';

export interface WebSocketMessage<T = unknown> {
  type: WebSocketEventType;
  payload: T;
  timestamp: string;
}

export interface PriceUpdatePayload {
  vendorId: string;
  eventId: string;
  items: PriceUpdateItem[];
}

export interface PriceUpdateItem {
  menuItemId: string;
  eventMenuItemId?: string;
  oldPrice: number;
  newPrice: number;
  name?: string;
}

export interface MenuItemUpdatePayload {
  vendorId: string;
  eventId: string;
  menuItemId: string;
  eventMenuItemId?: string;
  changes: Record<string, unknown>;
}

export type AvailabilityStatus = 'AVAILABLE' | 'OUT_OF_STOCK' | 'LIMITED' | 'COMING_SOON' | 'DISCONTINUED';

export interface ItemAvailabilityPayload {
  vendorId: string;
  eventId: string;
  menuItemId: string;
  eventMenuItemId?: string;
  available: boolean;
  availabilityStatus: AvailabilityStatus;
}

export interface VendorStatusPayload {
  vendorId: string;
  isPaused: boolean;
}

export interface OrderStatusUpdatePayload {
  orderId: string;
  phone: string;
  status: string;
  vendorId: string;
  eventId?: string;
}

export interface NewOrderPayload {
  orderId: string;
  vendorId: string;
  eventId?: string;
}

export interface AdminOrderFeedPayload {
  orderId: string;
  customerPhone: string | null;
  customerName: string | null;
  vendorId: string;
  vendorName: string | null;
  eventId: string | null;
  eventName: string | null;
  total: number;
  status: string;
  paymentStatus: string | null;
  items: { name: string; quantity: number }[];
  createdAt: string;
}

export interface PaymentFailedPayload {
  orderId: string;
  customerPhone: string | null;
  vendorName: string | null;
  total: number;
  paymentStatus: string;
  timestamp: string;
}

export interface TicketUpdatePayload {
  ticketId: string;
  ticketNumber: number;
  action: 'created' | 'updated' | 'message';
  customerPhone: string | null;
  status?: string;
  subject?: string;
}

export interface NotificationPayload {
  title: string;
  message: string;
  type: NotificationType;
  actionUrl?: string;
}

// Client subscription tracking
export interface ClientSubscription {
  eventId?: string;
  vendorId?: string;
  organizerId?: string;
  phone?: string; // For order tracking
  admin?: boolean; // For admin dashboard subscriptions
}

// Authenticated user info attached to a WebSocket client
export interface WebSocketUser {
  userId: string;
  role: 'vendor' | 'organizer' | 'admin' | 'customer';
  vendorId?: string; // For vendor users — the vendor they belong to
}
