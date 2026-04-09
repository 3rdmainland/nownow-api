import { supabase } from '../lib/supabase.js';
import { getWhatsappService } from '../whatsapp/whatsapp.service.js';
import { ConsentService } from './consent.service.js';
import { formatToCurrency } from './format-helper.js';
import { redis } from '../lib/redis.js';
import type { RetentionNudge, NudgeStatus, UpsellPayload, PostEventSummaryPayload, ReorderPayload, EventNearbyPayload } from './retention.types.js';

const RATE_LIMIT_MAX_PER_HOUR = 3;
const RATE_LIMIT_KEY_PREFIX = 'rl:wa:';

const consent = new ConsentService();

/**
 * Process a single nudge by ID — called by QStash via the internal endpoint.
 * No polling, no batching — QStash calls this exactly once per nudge at the scheduled time.
 * QStash handles retries (3x with backoff) and deduplication.
 */
export async function processNudge(nudgeId: string): Promise<{ action: string }> {
  // 1. Fetch the nudge
  const { data: nudge, error } = await supabase
    .from('retention_nudges')
    .select('*')
    .eq('id', nudgeId)
    .single();

  if (error || !nudge) {
    console.error(`NudgeProcessor: nudge ${nudgeId} not found`);
    return { action: 'not_found' };
  }

  // Already processed (QStash retry of a completed nudge) — idempotent
  if (nudge.status !== 'pending') {
    return { action: 'already_processed' };
  }

  try {
    // 2. Check consent still active (marketing nudges only)
    if (nudge.nudge_type !== 'post_event_summary') {
      const hasConsent = await consent.hasConsent(nudge.customer_id, nudge.event_id, 'marketing');
      if (!hasConsent) {
        await updateNudgeStatus(nudge.id, 'cancelled');
        return { action: 'cancelled_no_consent' };
      }
    }

    // 3. Rate limit check via Redis (3 msgs/hr/phone)
    const rateLimitKey = `${RATE_LIMIT_KEY_PREFIX}${nudge.phone}`;
    const recentCount = (await redis.get(rateLimitKey)) as number | null;
    if (recentCount !== null && recentCount >= RATE_LIMIT_MAX_PER_HOUR) {
      await updateNudgeStatus(nudge.id, 'skipped');
      return { action: 'rate_limited' };
    }

    // 4. Check if customer has an active order (don't interrupt)
    const { count: activeOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('customer_id', nudge.customer_id)
      .eq('event_id', nudge.event_id)
      .in('status', ['PENDING', 'PREPARING']);

    if (activeOrders && activeOrders > 0) {
      await updateNudgeStatus(nudge.id, 'skipped');
      return { action: 'skipped_active_order' };
    }

    // 5. For upsell: check event hasn't ended
    if (nudge.nudge_type === 'upsell_during_event') {
      const { data: event } = await supabase
        .from('events')
        .select('end_date')
        .eq('id', nudge.event_id)
        .single();

      if (event?.end_date && new Date(event.end_date).getTime() < Date.now()) {
        await updateNudgeStatus(nudge.id, 'cancelled');
        return { action: 'cancelled_event_ended' };
      }
    }

    // 6. Send via WhatsApp
    await sendNudge(nudge as RetentionNudge);
    await updateNudgeStatus(nudge.id, 'sent');

    // 7. Increment rate limit counter in Redis (expires after 1 hour)
    await redis.incr(rateLimitKey);
    await redis.expire(rateLimitKey, 3600);

    return { action: 'sent' };
  } catch (err) {
    console.error(`NudgeProcessor: failed nudge ${nudge.id}`, (err as Error).message);
    await updateNudgeStatus(nudge.id, 'failed');
    // Throw so QStash retries
    throw err;
  }
}

async function sendNudge(nudge: RetentionNudge): Promise<void> {
  const token = process.env.WA_ACCESS_TOKEN;
  if (!token || token === 'disabled') {
    console.log(`NudgeProcessor: WA disabled, skipping nudge ${nudge.id}`);
    return;
  }

  const whatsapp = getWhatsappService();
  const payload = nudge.payload;

  switch (payload.type) {
    case 'upsell_during_event': {
      const p = payload as UpsellPayload;
      await whatsapp.sendUpsellTemplate(
        nudge.phone,
        {
          eventName: p.event_name,
          itemName: p.item_name,
          itemPrice: formatToCurrency(p.item_price),
          quickLinkUrl: p.quick_link_url,
        },
        nudge.id,
      );
      break;
    }
    case 'post_event_summary': {
      const p = payload as PostEventSummaryPayload;
      await whatsapp.sendPostEventSummaryTemplate(
        nudge.phone,
        {
          eventName: p.event_name,
          orderCount: String(p.order_count),
          totalSpent: formatToCurrency(p.total_spent),
        },
        nudge.id,
      );
      break;
    }
    case 'reorder_suggestion': {
      const p = payload as ReorderPayload;
      await whatsapp.sendReorderSuggestionTemplate(
        nudge.phone,
        {
          eventName: p.event_name,
          itemNames: p.item_names.join(', '),
          reorderUrl: p.reorder_url,
        },
        nudge.id,
      );
      break;
    }
    case 'event_nearby': {
      const p = payload as EventNearbyPayload;
      await whatsapp.sendEventNearbyTemplate(
        nudge.phone,
        {
          eventName: p.event_name,
          vendorNames: p.vendor_names.join(', '),
          eventUrl: p.event_url,
        },
        nudge.id,
      );
      break;
    }
  }
}

async function updateNudgeStatus(id: string, status: NudgeStatus): Promise<void> {
  const update: Record<string, any> = { status };
  if (status === 'sent') update.sent_at = new Date().toISOString();

  const { error } = await supabase
    .from('retention_nudges')
    .update(update)
    .eq('id', id);

  if (error) {
    console.error(`NudgeProcessor: status update failed for ${id}`, error.message);
  }
}
