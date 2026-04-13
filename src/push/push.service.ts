import webpush from 'web-push';
import { supabase } from '../lib/supabase.js';
import type { PushPayload, PushSubscriptionInput } from './push.types.js';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@nownow.co.za';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

class PushService {
  async subscribe(input: PushSubscriptionInput): Promise<void> {
    await supabase.from('push_subscriptions').upsert(
      {
        user_type: input.userType,
        user_id: input.userId,
        endpoint: input.endpoint,
        keys_p256dh: input.keys.p256dh,
        keys_auth: input.keys.auth,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'user_type,user_id,endpoint' }
    );
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  }

  /**
   * Send push notification to all subscriptions for a user.
   * Handles expired subscriptions (410 Gone) by removing them.
   */
  async sendToUser(userType: string, userId: string, payload: PushPayload): Promise<void> {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys_p256dh, keys_auth')
      .eq('user_type', userType)
      .eq('user_id', userId);

    if (!subs?.length) return;

    const jsonPayload = JSON.stringify(payload);

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
            },
            jsonPayload
          );
          await supabase
            .from('push_subscriptions')
            .update({ last_used_at: new Date().toISOString() })
            .eq('endpoint', sub.endpoint);
        } catch (err: any) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
        }
      })
    );
  }

  /**
   * Send push notification to a vendor (by vendor entity ID).
   * All vendor users subscribe with the vendor entity ID, so one subscription
   * covers everyone who has the KDS open for that vendor.
   */
  async sendToVendorUsers(vendorId: string, payload: PushPayload): Promise<void> {
    await this.sendToUser('vendor', vendorId, payload);
  }
}

export const pushService = new PushService();
