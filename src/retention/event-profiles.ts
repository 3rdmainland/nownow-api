import type { EventProfile } from './retention.types.js';

const EVENT_PROFILES: Record<string, EventProfile> = {
  festival: {
    event_type: 'festival',
    upsell_enabled: true,
    first_nudge_delay_minutes: 30,
    nudge_interval_minutes: 45,
    max_nudges_per_event: 3,
    post_event_summary_delay_hours: 2,
    reorder_suggestion_delay_days: 7,
    upsell_bias: 'popular',
  },
  concert: {
    event_type: 'concert',
    upsell_enabled: false, // Post-event only — don't interrupt the show
    first_nudge_delay_minutes: 0,
    nudge_interval_minutes: 0,
    max_nudges_per_event: 0,
    post_event_summary_delay_hours: 1,
    reorder_suggestion_delay_days: 14,
    upsell_bias: 'popular',
  },
  party: {
    event_type: 'party',
    upsell_enabled: true,
    first_nudge_delay_minutes: 20,
    nudge_interval_minutes: 30,
    max_nudges_per_event: 2,
    post_event_summary_delay_hours: 4,
    reorder_suggestion_delay_days: 14,
    upsell_bias: 'complementary',
  },
  farmers_market: {
    event_type: 'farmers_market',
    upsell_enabled: true,
    first_nudge_delay_minutes: 60,
    nudge_interval_minutes: 90,
    max_nudges_per_event: 1,
    post_event_summary_delay_hours: 3,
    reorder_suggestion_delay_days: 7, // Weekly markets → suggest next week
    upsell_bias: 'new',
  },
  food_festival: {
    event_type: 'food_festival',
    upsell_enabled: true,
    first_nudge_delay_minutes: 25,
    nudge_interval_minutes: 40,
    max_nudges_per_event: 3,
    post_event_summary_delay_hours: 2,
    reorder_suggestion_delay_days: 7,
    upsell_bias: 'complementary',
  },
  corporate: {
    event_type: 'corporate',
    upsell_enabled: false, // No marketing for corporate events
    first_nudge_delay_minutes: 0,
    nudge_interval_minutes: 0,
    max_nudges_per_event: 0,
    post_event_summary_delay_hours: 1,
    reorder_suggestion_delay_days: 0, // No reorder suggestions
    upsell_bias: 'popular',
  },
  sports: {
    event_type: 'sports',
    upsell_enabled: true,
    first_nudge_delay_minutes: 15, // Halftime nudges
    nudge_interval_minutes: 45,
    max_nudges_per_event: 2,
    post_event_summary_delay_hours: 1,
    reorder_suggestion_delay_days: 7,
    upsell_bias: 'popular',
  },
  default: {
    event_type: 'default',
    upsell_enabled: true,
    first_nudge_delay_minutes: 30,
    nudge_interval_minutes: 60,
    max_nudges_per_event: 2,
    post_event_summary_delay_hours: 2,
    reorder_suggestion_delay_days: 14,
    upsell_bias: 'popular',
  },
};

export function getEventProfile(eventType?: string): EventProfile {
  if (!eventType) return EVENT_PROFILES.default;
  return EVENT_PROFILES[eventType] ?? EVENT_PROFILES.default;
}
