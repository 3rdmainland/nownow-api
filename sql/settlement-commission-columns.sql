-- Settlement commission columns migration
-- Adds commission tracking to settlement tables and event_id scoping

-- Add commission columns to settlement_batches
ALTER TABLE settlement_batches ADD COLUMN IF NOT EXISTS total_commission_fees NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Add commission + event_id columns to settlement_payouts
ALTER TABLE settlement_payouts ADD COLUMN IF NOT EXISTS commission_fee NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE settlement_payouts ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE settlement_payouts ADD COLUMN IF NOT EXISTS event_id UUID;
ALTER TABLE settlement_payouts ADD COLUMN IF NOT EXISTS organizer_id UUID;

-- Add event_id and commission_fee to settlement_orders
ALTER TABLE settlement_orders ADD COLUMN IF NOT EXISTS event_id UUID;
ALTER TABLE settlement_orders ADD COLUMN IF NOT EXISTS commission_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Indexes for event-scoped queries
CREATE INDEX IF NOT EXISTS idx_settlement_payouts_event ON settlement_payouts(event_id);
CREATE INDEX IF NOT EXISTS idx_settlement_orders_event ON settlement_orders(event_id);
