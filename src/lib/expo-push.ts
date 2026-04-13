/**
 * Expo Push Notification Service
 *
 * Sends push notifications via Expo's push service.
 * Expo handles FCM (Android) and APNs (iOS) routing automatically.
 * No Firebase project or Apple certificates needed on the backend.
 *
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface ExpoPushMessage {
  to: string; // ExpoPushToken e.g. "ExponentPushToken[xxx]"
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  categoryId?: string;
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string; // receipt ID (on success)
  message?: string;
  details?: { error?: string };
}

/**
 * Send push notifications via Expo Push Service.
 * Accepts one or many messages (batched in a single HTTP call).
 * Returns tickets for each message.
 */
export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  const result = (await response.json()) as { data: ExpoPushTicket[] };
  return result.data;
}

/**
 * Check if an error ticket indicates the token is no longer valid.
 * Used to deactivate stale subscriptions.
 */
export function isInvalidTokenError(ticket: ExpoPushTicket): boolean {
  return (
    ticket.status === 'error' &&
    ticket.details?.error === 'DeviceNotRegistered'
  );
}
