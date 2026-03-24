export type NudgeType =
  | 'upsell_during_event'
  | 'post_event_summary'
  | 'reorder_suggestion'
  | 'event_nearby';

export type NudgeStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export type ConsentType = 'marketing' | 'transactional';

export interface RetentionNudge {
  id: string;
  customer_id: string;
  phone: string;
  event_id: string;
  order_id: string;
  nudge_type: NudgeType;
  status: NudgeStatus;
  scheduled_for: string; // ISO 8601
  sent_at?: string;
  payload: NudgePayload;
  created_at: string;
}

export type NudgePayload =
  | UpsellPayload
  | PostEventSummaryPayload
  | ReorderPayload
  | EventNearbyPayload;

export interface UpsellPayload {
  type: 'upsell_during_event';
  event_name: string;
  item_name: string;
  item_price: number;
  quick_link_url: string;
}

export interface PostEventSummaryPayload {
  type: 'post_event_summary';
  event_name: string;
  order_count: number;
  total_spent: number;
}

export interface ReorderPayload {
  type: 'reorder_suggestion';
  event_name: string;
  item_names: string[];
  reorder_url: string;
}

export interface EventNearbyPayload {
  type: 'event_nearby';
  event_name: string;
  vendor_names: string[];
  event_url: string;
}

export interface WhatsAppConsent {
  id: string;
  customer_id: string;
  phone: string;
  event_id: string;
  consent_type: ConsentType;
  granted: boolean;
  granted_at: string;
  revoked_at?: string;
}

export interface CustomerPreference {
  id: string;
  customer_id: string;
  phone: string;
  order_count: number;
  total_spent: number;
  avg_order_value: number;
  favorite_items: FavoriteItem[];
  last_order_at: string;
  created_at: string;
  updated_at: string;
}

export interface FavoriteItem {
  item_id: string;
  item_name: string;
  category_id?: string;
  order_count: number;
}

export interface EventProfile {
  event_type: string;
  upsell_enabled: boolean;
  first_nudge_delay_minutes: number;
  nudge_interval_minutes: number;
  max_nudges_per_event: number;
  post_event_summary_delay_hours: number;
  reorder_suggestion_delay_days: number;
  upsell_bias: 'popular' | 'complementary' | 'new';
}

export interface WhatsAppMessage {
  id: string;
  wa_message_id?: string;
  phone: string;
  template_name: string;
  category: 'utility' | 'marketing';
  status: 'sent' | 'delivered' | 'read' | 'failed';
  cost_zar: number;
  nudge_id?: string;
  created_at: string;
  updated_at?: string;
}
