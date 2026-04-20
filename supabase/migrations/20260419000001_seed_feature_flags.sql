-- Seed feature_flags into platform_config if not already present.
-- Merges new flags with any existing ones so manual changes aren't lost.

INSERT INTO platform_config (key, value)
VALUES (
  'feature_flags',
  '{
    "vendor_pos": false,
    "vendor_billing": true,
    "menu_templates": false,
    "discounts": false,
    "retention": false,
    "reorder": false,
    "push_notifications": true,
    "online_payments": false,
    "vendor_events": false
  }'::jsonb
)
ON CONFLICT (key) DO UPDATE
SET value = platform_config.value || EXCLUDED.value,
    updated_at = now();
