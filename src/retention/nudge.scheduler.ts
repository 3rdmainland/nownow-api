import { supabase } from '../lib/supabase.js';
import { qstash, getCallbackBaseUrl } from '../lib/qstash.js';
import { getEventProfile } from './event-profiles.js';
import { ConsentService } from './consent.service.js';
import { PreferenceService } from './preference.service.js';
import { UpsellPicker } from './upsell-picker.js';
import type { NudgeType, UpsellPayload, PostEventSummaryPayload, ReorderPayload } from './retention.types.js';

interface OrderInput {
  id: string;
  customer_id?: string;
  phone: string;
  event_id: string;
  total: number;
  items: Array<{ id: string; name: string; category_id?: string; quantity: number }>;
}

interface EventInput {
  id: string;
  name: string;
  code: string;
  end_date?: string;
  event_type?: string;
}

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://nownow-nine.vercel.app';

export class NudgeScheduler {
  private consent = new ConsentService();
  private preferences = new PreferenceService();
  private upsellPicker = new UpsellPicker();

  /**
   * Called after order collection. Schedules retention nudges via QStash.
   * Each nudge is: 1) inserted into DB as log, 2) published to QStash with delay.
   * QStash calls /internal/nudge/send at the scheduled time.
   */
  async scheduleRetentionNudges(order: OrderInput, event: EventInput): Promise<void> {
    const customerId = order.customer_id;
    if (!customerId || !order.phone) return;

    const callbackUrl = getCallbackBaseUrl();
    if (!callbackUrl || !qstash) {
      console.warn('NudgeScheduler: QStash not configured, skipping nudge scheduling');
      return;
    }

    const profile = getEventProfile(event.event_type);

    // Check marketing consent
    const hasMarketing = await this.consent.hasConsent(customerId, event.id, 'marketing');

    // Always update preferences (non-marketing, purely internal)
    void this.preferences.updateFromOrder(customerId, order.phone, order);

    const nudges: Array<{
      customer_id: string;
      phone: string;
      event_id: string;
      order_id: string;
      nudge_type: NudgeType;
      status: 'pending';
      scheduled_for: string;
      payload: any;
      created_at: string;
    }> = [];

    const now = Date.now();
    const created_at = new Date().toISOString();

    // 1. Upsell nudges (marketing consent required, event profile must allow)
    if (hasMarketing && profile.upsell_enabled && profile.max_nudges_per_event > 0) {
      const eventEndMs = event.end_date ? new Date(event.end_date).getTime() : 0;

      for (let i = 0; i < profile.max_nudges_per_event; i++) {
        const delayMs =
          (profile.first_nudge_delay_minutes + i * profile.nudge_interval_minutes) * 60 * 1000;
        const scheduledFor = new Date(now + delayMs);

        // Don't schedule past event end
        if (eventEndMs && scheduledFor.getTime() > eventEndMs) break;

        const upsell = await this.upsellPicker.pickUpsellItem(
          event.id,
          customerId,
          profile.upsell_bias,
        );

        if (!upsell) break;

        const quickLinkUrl = `${APP_BASE_URL}/e/${event.code}`;

        const payload: UpsellPayload = {
          type: 'upsell_during_event',
          event_name: event.name,
          item_name: upsell.itemName,
          item_price: upsell.itemPrice,
          quick_link_url: quickLinkUrl,
        };

        nudges.push({
          customer_id: customerId,
          phone: order.phone,
          event_id: event.id,
          order_id: order.id,
          nudge_type: 'upsell_during_event',
          status: 'pending',
          scheduled_for: scheduledFor.toISOString(),
          payload,
          created_at,
        });
      }
    }

    // 2. Post-event summary (utility — no marketing consent needed)
    if (profile.post_event_summary_delay_hours > 0) {
      const summaryDelayMs = profile.post_event_summary_delay_hours * 60 * 60 * 1000;
      const eventEndMs = event.end_date ? new Date(event.end_date).getTime() : now;
      const scheduledFor = new Date(eventEndMs + summaryDelayMs);

      const { count: orderCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', event.id)
        .eq('customer_id', customerId);

      const { data: orderTotals } = await supabase
        .from('orders')
        .select('total')
        .eq('event_id', event.id)
        .eq('customer_id', customerId);

      const totalSpent =
        orderTotals?.reduce((sum, o) => sum + (o.total ?? 0), 0) ?? order.total;

      const payload: PostEventSummaryPayload = {
        type: 'post_event_summary',
        event_name: event.name,
        order_count: orderCount ?? 1,
        total_spent: totalSpent,
      };

      nudges.push({
        customer_id: customerId,
        phone: order.phone,
        event_id: event.id,
        order_id: order.id,
        nudge_type: 'post_event_summary',
        status: 'pending',
        scheduled_for: scheduledFor.toISOString(),
        payload,
        created_at,
      });
    }

    // 3. Reorder suggestion (marketing consent required)
    if (hasMarketing && profile.reorder_suggestion_delay_days > 0) {
      const reorderDelayMs = profile.reorder_suggestion_delay_days * 24 * 60 * 60 * 1000;
      const scheduledFor = new Date(now + reorderDelayMs);

      const itemNames = order.items.map((i) => i.name).slice(0, 3);
      const reorderUrl = `${APP_BASE_URL}/reorder/${order.id}`;

      const payload: ReorderPayload = {
        type: 'reorder_suggestion',
        event_name: event.name,
        item_names: itemNames,
        reorder_url: reorderUrl,
      };

      nudges.push({
        customer_id: customerId,
        phone: order.phone,
        event_id: event.id,
        order_id: order.id,
        nudge_type: 'reorder_suggestion',
        status: 'pending',
        scheduled_for: scheduledFor.toISOString(),
        payload,
        created_at,
      });
    }

    if (nudges.length === 0) return;

    // Batch insert into DB (as a log — status tracking + admin stats)
    const { data: inserted, error: insertError } = await supabase
      .from('retention_nudges')
      .insert(nudges)
      .select('id, scheduled_for');

    if (insertError || !inserted?.length) {
      console.error('NudgeScheduler: DB insert failed', insertError?.message);
      return;
    }

    // Publish all nudges to QStash in parallel
    const endpoint = `${callbackUrl}/internal/nudge/send`;

    const results = await Promise.allSettled(
      inserted.map(row => {
        const delaySec = Math.max(0, Math.floor((new Date(row.scheduled_for).getTime() - Date.now()) / 1000));
        return qstash.publishJSON({
          url: endpoint,
          body: { nudgeId: row.id },
          delay: delaySec,
          retries: 3,
          deduplicationId: row.id,
        });
      })
    );
    const published = results.filter(r => r.status === 'fulfilled').length;
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('NudgeScheduler: QStash publish failed', r.reason?.message || r.reason);
      }
    }

    console.log(`NudgeScheduler: scheduled ${published}/${inserted.length} nudges via QStash for order ${order.id}`);
  }
}
