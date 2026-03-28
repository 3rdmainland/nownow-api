import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type {
  WebSocketMessage,
  PriceUpdatePayload,
  MenuItemUpdatePayload,
  ItemAvailabilityPayload,
  VendorStatusPayload,
  OrderStatusUpdatePayload,
  NewOrderPayload,
  ClientSubscription,
  AdminOrderFeedPayload,
  PaymentFailedPayload,
  TicketUpdatePayload,
  NotificationPayload,
  WebSocketUser,
} from './websocket.types';

const MAX_CONNECTIONS = 1000;

// Allowed subscription keys to prevent arbitrary payload injection
const ALLOWED_SUBSCRIPTION_KEYS = new Set(['eventId', 'vendorId', 'organizerId', 'phone', 'admin']);

// Store connected clients with their subscriptions
interface ConnectedClient {
  socket: WebSocket;
  subscriptions: ClientSubscription;
  user: WebSocketUser | null; // null = unauthenticated (limited access)
}

const clients: Map<WebSocket, ConnectedClient> = new Map();

/**
 * Broadcast a message to all connected clients
 */
export function broadcast<T>(message: WebSocketMessage<T>): void {
  const messageStr = JSON.stringify(message);

  for (const [socket, client] of clients) {
    if (socket.readyState === socket.OPEN) {
      socket.send(messageStr);
    }
  }
}

/**
 * Broadcast to clients subscribed to a specific event
 */
export function broadcastToEvent<T>(eventId: string, message: WebSocketMessage<T>): void {
  const messageStr = JSON.stringify(message);

  for (const [socket, client] of clients) {
    if (socket.readyState === socket.OPEN) {
      // Send to clients subscribed to this event or all events
      if (!client.subscriptions.eventId || client.subscriptions.eventId === eventId) {
        socket.send(messageStr);
      }
    }
  }
}

/**
 * Broadcast to clients subscribed to a specific vendor
 */
export function broadcastToVendor<T>(vendorId: string, message: WebSocketMessage<T>): void {
  const messageStr = JSON.stringify(message);

  for (const [socket, client] of clients) {
    if (socket.readyState === socket.OPEN) {
      // Send to clients subscribed to this vendor or all vendors
      if (!client.subscriptions.vendorId || client.subscriptions.vendorId === vendorId) {
        socket.send(messageStr);
      }
    }
  }
}

/**
 * Broadcast to all admin-subscribed clients
 */
export function broadcastToAdmins<T>(message: WebSocketMessage<T>): void {
  const messageStr = JSON.stringify(message);

  for (const [socket, client] of clients) {
    if (socket.readyState === socket.OPEN && client.subscriptions.admin) {
      socket.send(messageStr);
    }
  }
}

/**
 * Broadcast admin order feed event
 */
export function broadcastAdminOrderFeed(payload: AdminOrderFeedPayload): void {
  broadcastToAdmins({
    type: 'ADMIN_ORDER_FEED',
    payload,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast payment failure to admins
 */
export function broadcastPaymentFailed(payload: PaymentFailedPayload): void {
  broadcastToAdmins({
    type: 'PAYMENT_FAILED',
    payload,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast price update to relevant clients
 */
export function broadcastPriceUpdate(payload: PriceUpdatePayload): void {
  const message: WebSocketMessage<PriceUpdatePayload> = {
    type: 'PRICE_UPDATE',
    payload,
    timestamp: new Date().toISOString(),
  };

  broadcastToEvent(payload.eventId, message);
}

/**
 * Broadcast menu item update
 */
export function broadcastMenuItemUpdate(payload: MenuItemUpdatePayload): void {
  const message: WebSocketMessage<MenuItemUpdatePayload> = {
    type: 'MENU_ITEM_UPDATE',
    payload,
    timestamp: new Date().toISOString(),
  };

  broadcastToEvent(payload.eventId, message);
}

/**
 * Broadcast availability update
 */
export function broadcastAvailabilityUpdate(payload: ItemAvailabilityPayload): void {
  const message: WebSocketMessage<ItemAvailabilityPayload> = {
    type: 'ITEM_AVAILABILITY_UPDATE',
    payload,
    timestamp: new Date().toISOString(),
  };

  broadcastToEvent(payload.eventId, message);
}

/**
 * Broadcast vendor status update
 */
export function broadcastVendorStatus(payload: VendorStatusPayload): void {
  const message: WebSocketMessage<VendorStatusPayload> = {
    type: 'VENDOR_STATUS_UPDATE',
    payload,
    timestamp: new Date().toISOString(),
  };

  broadcastToVendor(payload.vendorId, message);
}

/**
 * Broadcast to clients subscribed to a specific phone number (for order tracking)
 */
export function broadcastToPhone<T>(phone: string, message: WebSocketMessage<T>): void {
  const messageStr = JSON.stringify(message);

  for (const [socket, client] of clients) {
    if (socket.readyState === socket.OPEN) {
      // Send to clients subscribed to this phone number
      if (client.subscriptions.phone === phone) {
        socket.send(messageStr);
      }
    }
  }
}

/**
 * Broadcast order status update to the customer tracking their order
 */
export function broadcastOrderStatusUpdate(payload: OrderStatusUpdatePayload): void {
  const message: WebSocketMessage<OrderStatusUpdatePayload> = {
    type: 'ORDER_STATUS_UPDATE',
    payload,
    timestamp: new Date().toISOString(),
  };

  broadcastToPhone(payload.phone, message);
}

/**
 * Broadcast new order notification to the vendor
 */
export function broadcastNewOrder(payload: NewOrderPayload): void {
  const message: WebSocketMessage<NewOrderPayload> = {
    type: 'NEW_ORDER',
    payload,
    timestamp: new Date().toISOString(),
  };

  broadcastToVendor(payload.vendorId, message);
}

/**
 * Broadcast ticket update to the customer (by phone) AND all admins
 */
export function broadcastTicketUpdate(payload: TicketUpdatePayload): void {
  const message: WebSocketMessage<TicketUpdatePayload> = {
    type: 'TICKET_UPDATE',
    payload,
    timestamp: new Date().toISOString(),
  };

  // Notify admins
  broadcastToAdmins(message);

  // Notify the customer by phone
  if (payload.customerPhone) {
    broadcastToPhone(payload.customerPhone, message);
  }
}

/**
 * Broadcast to clients subscribed to a specific organizer
 */
export function broadcastToOrganizer<T>(organizerId: string, message: WebSocketMessage<T>): void {
  const messageStr = JSON.stringify(message);

  for (const [socket, client] of clients) {
    if (socket.readyState === socket.OPEN) {
      if (client.subscriptions.organizerId === organizerId) {
        socket.send(messageStr);
      }
    }
  }
}

/**
 * Broadcast a notification to a specific vendor
 */
export function broadcastNotification(vendorId: string, payload: NotificationPayload): void {
  broadcastToVendor(vendorId, {
    type: 'NOTIFICATION',
    payload,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast a notification to a specific organizer
 */
export function broadcastNotificationToOrganizer(organizerId: string, payload: NotificationPayload): void {
  broadcastToOrganizer(organizerId, {
    type: 'NOTIFICATION',
    payload,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get connection stats (sanitized — no user details)
 */
export function getConnectionStats() {
  const roleBreakdown: Record<string, number> = {};
  for (const [, client] of clients) {
    const role = client.user?.role || 'anonymous';
    roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
  }

  return {
    totalConnections: clients.size,
    byRole: roleBreakdown,
  };
}

/**
 * Validate that a SUBSCRIBE payload only contains allowed keys
 * and that the user is authorized to subscribe to the requested resources.
 */
function validateSubscription(
  payload: Record<string, unknown>,
  user: WebSocketUser | null,
): { valid: boolean; sanitized: Partial<ClientSubscription>; error?: string } {
  const sanitized: Partial<ClientSubscription> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!ALLOWED_SUBSCRIPTION_KEYS.has(key)) continue;

    if (key === 'admin') {
      if (!user || user.role !== 'admin') {
        return { valid: false, sanitized, error: 'Admin subscription requires admin role' };
      }
      sanitized.admin = Boolean(value);
    } else if (key === 'vendorId') {
      if (!user || (user.role !== 'admin' && user.vendorId !== value)) {
        return { valid: false, sanitized, error: 'Cannot subscribe to a vendor you do not belong to' };
      }
      sanitized.vendorId = value as string;
    } else if (key === 'organizerId') {
      if (!user || (user.role !== 'admin' && user.role !== 'organizer')) {
        return { valid: false, sanitized, error: 'Organizer subscription requires organizer or admin role' };
      }
      if (user.role === 'organizer' && user.userId !== value) {
        return { valid: false, sanitized, error: 'Cannot subscribe to another organizer' };
      }
      sanitized.organizerId = value as string;
    } else if (key === 'phone') {
      // Phone subscriptions are for customer order tracking — allow for any authenticated user or anonymous
      sanitized.phone = value as string;
    } else if (key === 'eventId') {
      sanitized.eventId = value as string;
    }
  }

  return { valid: true, sanitized };
}

/**
 * WebSocket controller plugin
 */
async function websocketController(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Register WebSocket plugin
  await fastify.register(websocket);

  // WebSocket connection endpoint
  // Clients pass JWT via ?token=<jwt> query parameter
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    // Reject if at capacity
    if (clients.size >= MAX_CONNECTIONS) {
      socket.close(1013, 'Server at capacity');
      return;
    }

    // Authenticate via query-string token
    let wsUser: WebSocketUser | null = null;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      if (token) {
        const decoded = fastify.jwt.verify<{ userId: string; role: string; vendorId?: string }>(token);
        wsUser = {
          userId: decoded.userId,
          role: decoded.role as WebSocketUser['role'],
          vendorId: decoded.vendorId,
        };
      }
    } catch {
      // Invalid token — continue as unauthenticated (limited access)
    }

    fastify.log.info({ authenticated: !!wsUser, role: wsUser?.role }, 'New WebSocket connection');

    // Initialize client with empty subscriptions
    const client: ConnectedClient = {
      socket,
      subscriptions: {},
      user: wsUser,
    };
    clients.set(socket, client);

    // Send welcome message
    socket.send(JSON.stringify({
      type: 'CONNECTED',
      payload: {
        message: 'Connected to NowNow real-time updates',
        authenticated: !!wsUser,
      },
      timestamp: new Date().toISOString(),
    }));

    // Handle incoming messages (for subscriptions)
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle subscription requests
        if (message.type === 'SUBSCRIBE') {
          const existingClient = clients.get(socket);
          if (existingClient && message.payload && typeof message.payload === 'object') {
            const { valid, sanitized, error } = validateSubscription(message.payload, existingClient.user);

            if (!valid) {
              socket.send(JSON.stringify({
                type: 'ERROR',
                payload: { message: error },
                timestamp: new Date().toISOString(),
              }));
              return;
            }

            existingClient.subscriptions = {
              ...existingClient.subscriptions,
              ...sanitized,
            };
            fastify.log.info({ subscriptions: existingClient.subscriptions }, 'Client subscribed');

            socket.send(JSON.stringify({
              type: 'SUBSCRIBED',
              payload: existingClient.subscriptions,
              timestamp: new Date().toISOString(),
            }));
          }
        }

        // Handle unsubscribe
        if (message.type === 'UNSUBSCRIBE') {
          const existingClient = clients.get(socket);
          if (existingClient) {
            existingClient.subscriptions = {};
            fastify.log.info('Client unsubscribed');
          }
        }
      } catch (err) {
        fastify.log.error({ err }, 'Failed to parse WebSocket message');
      }
    });

    // Handle close
    socket.on('close', () => {
      fastify.log.info('WebSocket connection closed');
      clients.delete(socket);
    });

    // Handle errors
    socket.on('error', (err) => {
      fastify.log.error({ err }, 'WebSocket error');
      clients.delete(socket);
    });
  });

  // REST endpoint to check WebSocket stats (admin only)
  fastify.get('/ws/stats', { preHandler: [async (request) => {
    try {
      await request.jwtVerify();
      const payload = request.user as { role?: string };
      if (payload.role !== 'admin') {
        throw new Error('Forbidden');
      }
    } catch {
      throw { statusCode: 403, message: 'Admin access required' };
    }
  }] }, async () => {
    return getConnectionStats();
  });
}

export default websocketController;
