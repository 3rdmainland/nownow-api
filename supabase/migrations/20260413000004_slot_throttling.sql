ALTER TABLE event_menu_configurations
    ADD COLUMN IF NOT EXISTS max_orders_per_slot integer,
    ADD COLUMN IF NOT EXISTS slot_duration_minutes integer DEFAULT 15;
