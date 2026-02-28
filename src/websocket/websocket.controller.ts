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
} from './websocket.types';

// Store connected clients with their subscriptions
interface ConnectedClient {
  socket: WebSocket;
  subscriptions: ClientSubscription;
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
 * Get connection stats
 */
export function getConnectionStats() {
  return {
    totalConnections: clients.size,
    connections: Array.from(clients.values()).map(c => ({
      subscriptions: c.subscriptions,
    })),
  };
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
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    fastify.log.info('New WebSocket connection');

    // Initialize client with empty subscriptions
    const client: ConnectedClient = {
      socket,
      subscriptions: {},
    };
    clients.set(socket, client);

    // Send welcome message
    socket.send(JSON.stringify({
      type: 'CONNECTED',
      payload: { message: 'Connected to NowNow real-time updates' },
      timestamp: new Date().toISOString(),
    }));

    // Handle incoming messages (for subscriptions)
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle subscription requests
        if (message.type === 'SUBSCRIBE') {
          const existingClient = clients.get(socket);
          if (existingClient) {
            existingClient.subscriptions = {
              ...existingClient.subscriptions,
              ...message.payload,
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

  // REST endpoint to check WebSocket stats (for monitoring)
  fastify.get('/ws/stats', async () => {
    return getConnectionStats();
  });
}

export default websocketController;
