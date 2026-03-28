import { NotificationService } from './notifications.service.js';
import { broadcastNotification, broadcastNotificationToOrganizer } from '../websocket/websocket.controller.js';
import type { NotificationType } from './notifications.types.js';

const notificationService = new NotificationService();

interface NotifyPayload {
  title: string;
  message: string;
  type: NotificationType;
  actionUrl?: string;
}

/** Persist + broadcast a notification to a vendor user (fire-and-forget). */
export function notifyVendorUser(vendorId: string, targetUserId: string, payload: NotifyPayload): void {
  notificationService.sendSystemNotification({
    ...payload,
    audience: 'vendor',
    targetUserId,
  }).catch(() => {});
  broadcastNotification(vendorId, payload);
}

/** Persist + broadcast a notification to an organizer (fire-and-forget). */
export function notifyOrganizer(organizerId: string, payload: NotifyPayload): void {
  notificationService.sendSystemNotification({
    ...payload,
    audience: 'organizer',
    targetUserId: organizerId,
  }).catch(() => {});
  broadcastNotificationToOrganizer(organizerId, payload);
}
