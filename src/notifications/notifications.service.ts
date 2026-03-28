import { supabase } from '../lib/supabase.js';
import {
  SendNotificationPayload,
  NotificationAudience,
  RecipientNotification,
  NotificationListResponse,
  SentNotification,
  SentNotificationListResponse,
} from './notifications.types.js';

interface ResolvedRecipient {
  userId: string;
  recipientType: 'vendor' | 'organizer';
}

let cachedSystemSenderId: string | null = null;

export class NotificationService {
  private async getSystemSenderId(): Promise<string> {
    if (cachedSystemSenderId) return cachedSystemSenderId;
    const { data: admin } = await supabase
      .from('admin_users')
      .select('id')
      .limit(1)
      .single();
    if (!admin?.id) throw new Error('No admin user found for system notification sender');
    cachedSystemSenderId = admin.id;
    return admin.id;
  }

  async sendNotification(payload: SendNotificationPayload, sentBy: string): Promise<{ id: string; recipientCount: number }> {
    // Insert platform notification
    const { data: notification, error: insertError } = await supabase
      .from('platform_notifications')
      .insert({
        title: payload.title,
        message: payload.message,
        type: payload.type,
        action_url: payload.actionUrl || null,
        audience: payload.audience,
        target_user_id: payload.targetUserId || null,
        sent_by: sentBy,
      })
      .select('id')
      .single();

    if (insertError || !notification) {
      throw new Error(`Failed to create notification: ${insertError?.message}`);
    }

    // Resolve recipients and fan out
    const recipients = await this.resolveRecipients(payload.audience, payload.targetUserId);

    if (recipients.length > 0) {
      const recipientRows = recipients.map(r => ({
        notification_id: notification.id,
        recipient_user_id: r.userId,
        recipient_type: r.recipientType,
      }));

      const { error: fanoutError } = await supabase
        .from('notification_recipients')
        .insert(recipientRows);

      if (fanoutError) {
        // Clean up the orphaned notification row
        await supabase.from('platform_notifications').delete().eq('id', notification.id);
        throw new Error(`Failed to fan out notification: ${fanoutError.message}`);
      }
    }

    return { id: notification.id, recipientCount: recipients.length };
  }

  /**
   * Send a system notification (no admin sender — uses a system sentinel).
   * Used for automated notifications like vendor invites.
   */
  async sendSystemNotification(payload: SendNotificationPayload): Promise<{ id: string; recipientCount: number }> {
    const sentBy = await this.getSystemSenderId();
    return this.sendNotification(payload, sentBy);
  }

  private async resolveRecipients(audience: NotificationAudience, targetUserId?: string): Promise<ResolvedRecipient[]> {
    const recipients: ResolvedRecipient[] = [];

    if (audience === 'vendor' && targetUserId) {
      recipients.push({ userId: targetUserId, recipientType: 'vendor' });
      return recipients;
    }

    if (audience === 'organizer' && targetUserId) {
      recipients.push({ userId: targetUserId, recipientType: 'organizer' });
      return recipients;
    }

    // Fetch vendors
    if (audience === 'all' || audience === 'all_vendors') {
      const { data: vendors } = await supabase
        .from('vendor_users')
        .select('id')
        .eq('is_active', true);

      if (vendors) {
        for (const v of vendors) {
          recipients.push({ userId: v.id, recipientType: 'vendor' });
        }
      }
    }

    // Fetch organizers
    if (audience === 'all' || audience === 'all_organizers') {
      const { data: organizers } = await supabase
        .from('organizer_users')
        .select('id')
        .eq('is_active', true);

      if (organizers) {
        for (const o of organizers) {
          recipients.push({ userId: o.id, recipientType: 'organizer' });
        }
      }
    }

    return recipients;
  }

  async getRecipientNotifications(
    userId: string,
    recipientType: 'vendor' | 'organizer',
    params: { page: number; limit: number; unreadOnly: boolean }
  ): Promise<NotificationListResponse> {
    const { page, limit, unreadOnly } = params;
    const offset = (page - 1) * limit;

    // Build all three queries up front
    const unreadQuery = supabase
      .from('notification_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_user_id', userId)
      .eq('recipient_type', recipientType)
      .eq('is_read', false);

    let notifQuery = supabase
      .from('notification_recipients')
      .select(`
        id,
        notification_id,
        is_read,
        read_at,
        created_at,
        platform_notifications!inner (
          title,
          message,
          type,
          action_url,
          created_at
        )
      `)
      .eq('recipient_user_id', userId)
      .eq('recipient_type', recipientType)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    let countQuery = supabase
      .from('notification_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_user_id', userId)
      .eq('recipient_type', recipientType);

    if (unreadOnly) {
      notifQuery = notifQuery.eq('is_read', false);
      countQuery = countQuery.eq('is_read', false);
    }

    // Run all three queries concurrently
    const [{ count: unreadCount }, { data, error }, { count: total }] = await Promise.all([
      unreadQuery,
      notifQuery,
      countQuery,
    ]);

    if (error) throw new Error(`Failed to fetch notifications: ${error.message}`);

    const notifications: RecipientNotification[] = (data || []).map((row: any) => ({
      id: row.id,
      notificationId: row.notification_id,
      title: row.platform_notifications.title,
      message: row.platform_notifications.message,
      type: row.platform_notifications.type,
      actionUrl: row.platform_notifications.action_url,
      isRead: row.is_read,
      readAt: row.read_at,
      createdAt: row.platform_notifications.created_at,
    }));

    return {
      notifications,
      total: total || 0,
      unreadCount: unreadCount || 0,
    };
  }

  async getUnreadCount(userId: string, recipientType: 'vendor' | 'organizer'): Promise<number> {
    const { count } = await supabase
      .from('notification_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_user_id', userId)
      .eq('recipient_type', recipientType)
      .eq('is_read', false);

    return count || 0;
  }

  async markAsRead(recipientRowId: string, userId: string, recipientType: 'vendor' | 'organizer'): Promise<void> {
    const { data, error } = await supabase
      .from('notification_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', recipientRowId)
      .eq('recipient_user_id', userId)
      .eq('recipient_type', recipientType)
      .select('id');

    if (error) throw new Error(`Failed to mark notification as read: ${error.message}`);
    if (!data || data.length === 0) throw new Error('Notification not found');
  }

  async markAllAsRead(userId: string, recipientType: 'vendor' | 'organizer'): Promise<number> {
    const { data, error } = await supabase
      .from('notification_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('recipient_user_id', userId)
      .eq('recipient_type', recipientType)
      .eq('is_read', false)
      .select('id');

    if (error) throw new Error(`Failed to mark all as read: ${error.message}`);
    return data?.length || 0;
  }

  async getSentNotifications(params: {
    page: number;
    limit: number;
    audience?: string;
  }): Promise<SentNotificationListResponse> {
    const { page, limit, audience } = params;
    const offset = (page - 1) * limit;

    // Get notifications with sender info
    let query = supabase
      .from('platform_notifications')
      .select(`
        *,
        admin_users!inner ( email )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (audience) {
      query = query.eq('audience', audience);
    }

    const { data, error, count: total } = await query;
    if (error) throw new Error(`Failed to fetch sent notifications: ${error.message}`);

    if (!data || data.length === 0) {
      return { notifications: [], total: total || 0 };
    }

    // Batch-fetch delivery stats for ALL notification IDs in a single query
    const notificationIds = data.map(row => row.id);
    const { data: statsRows } = await supabase
      .from('notification_recipients')
      .select('notification_id, is_read')
      .in('notification_id', notificationIds);

    // Aggregate counts in memory
    const statsMap = new Map<string, { total: number; read: number }>();
    for (const row of statsRows || []) {
      const entry = statsMap.get(row.notification_id) || { total: 0, read: 0 };
      entry.total++;
      if (row.is_read) entry.read++;
      statsMap.set(row.notification_id, entry);
    }

    const notifications: SentNotification[] = data.map(row => {
      const stats = statsMap.get(row.id) || { total: 0, read: 0 };
      return {
        id: row.id,
        title: row.title,
        message: row.message,
        type: row.type,
        actionUrl: row.action_url,
        audience: row.audience,
        targetUserId: row.target_user_id,
        sentBy: row.sent_by,
        sentByEmail: (row as any).admin_users?.email || 'System',
        createdAt: row.created_at,
        totalRecipients: stats.total,
        readCount: stats.read,
      };
    });

    return { notifications, total: total || 0 };
  }
}
