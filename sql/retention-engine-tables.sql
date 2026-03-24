-- Retention Engine Tables
-- Run this migration to set up the NowNow AI Retention Engine

-- 1. Add event_type to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'default';

-- 2. WhatsApp consent tracking (POPIA compliance)
CREATE TABLE IF NOT EXISTS whatsapp_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    phone TEXT NOT NULL,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    consent_type TEXT NOT NULL CHECK (consent_type IN ('marketing', 'transactional')),
    granted BOOLEAN NOT NULL DEFAULT true,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, event_id, consent_type)
);

CREATE INDEX idx_whatsapp_consents_customer ON whatsapp_consents(customer_id);
CREATE INDEX idx_whatsapp_consents_phone ON whatsapp_consents(phone);
CREATE INDEX idx_whatsapp_consents_event ON whatsapp_consents(event_id);

-- 3. WhatsApp message delivery tracking
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    template_name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('utility', 'marketing')),
    wa_message_id TEXT,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    cost_zar NUMERIC(6,2),
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_messages_phone ON whatsapp_messages(phone);
CREATE INDEX idx_whatsapp_messages_wa_id ON whatsapp_messages(wa_message_id);
CREATE INDEX idx_whatsapp_messages_status ON whatsapp_messages(status);
CREATE INDEX idx_whatsapp_messages_created ON whatsapp_messages(created_at);

-- 4. Retention nudge queue
CREATE TABLE IF NOT EXISTS retention_nudges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    phone TEXT NOT NULL,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    order_id UUID,
    nudge_type TEXT NOT NULL CHECK (nudge_type IN ('upsell_during_event', 'post_event_summary', 'reorder_suggestion', 'event_nearby')),
    template_params JSONB NOT NULL DEFAULT '{}',
    scheduled_for TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed', 'cancelled')),
    skip_reason TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_retention_nudges_pending ON retention_nudges(status, scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_retention_nudges_customer_event ON retention_nudges(customer_id, event_id);
CREATE INDEX idx_retention_nudges_phone ON retention_nudges(phone);
CREATE INDEX idx_retention_nudges_event ON retention_nudges(event_id);

-- 5. Customer preferences (learned from order history)
CREATE TABLE IF NOT EXISTS customer_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    preferred_categories TEXT[] DEFAULT '{}',
    order_count INTEGER NOT NULL DEFAULT 0,
    total_spent NUMERIC(10,2) NOT NULL DEFAULT 0,
    avg_order_value NUMERIC(10,2) NOT NULL DEFAULT 0,
    favorite_items JSONB NOT NULL DEFAULT '[]',
    last_order_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_preferences_customer ON customer_preferences(customer_id);
CREATE INDEX idx_customer_preferences_phone ON customer_preferences(phone);
