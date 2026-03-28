export type NotificationType = 'info' | 'warning' | 'success' | 'action';
export type NotificationAudience = 'all' | 'all_vendors' | 'all_organizers' | 'vendor' | 'organizer';

export interface SendNotificationPayload {
  title: string;
  message: string;
  type: NotificationType;
  actionUrl?: string;
  audience: NotificationAudience;
  targetUserId?: string;
}

export interface PlatformNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  actionUrl: string | null;
  audience: NotificationAudience;
  targetUserId: string | null;
  sentBy: string;
  createdAt: string;
}

export interface RecipientNotification {
  id: string;
  notificationId: string;
  title: string;
  message: string;
  type: NotificationType;
  actionUrl: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface SentNotification extends PlatformNotification {
  sentByEmail: string;
  totalRecipients: number;
  readCount: number;
}

export interface NotificationListResponse {
  notifications: RecipientNotification[];
  total: number;
  unreadCount: number;
}

export interface SentNotificationListResponse {
  notifications: SentNotification[];
  total: number;
}
