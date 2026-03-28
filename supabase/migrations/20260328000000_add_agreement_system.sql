-- Agreement System + Notifications Migration
-- Idempotent: all statements use IF NOT EXISTS / IF NOT EXISTS guards

-- ── 1. events.organizer_id ──────────────────────────────────────────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_id UUID;
CREATE INDEX IF NOT EXISTS idx_events_organizer ON events(organizer_id);

-- ── 2. event_vendors.status ─────────────────────────────────────────────────
-- Default 'accepted' preserves backward compatibility for existing rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_vendors' AND column_name = 'status'
  ) THEN
    ALTER TABLE event_vendors ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted';
    ALTER TABLE event_vendors ADD CONSTRAINT chk_event_vendors_status
      CHECK (status IN ('invited', 'accepted', 'declined'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_vendors_status ON event_vendors(event_id, status);

-- ── 3. vendor_users.is_active ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vendor_users' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE vendor_users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- ── 4. organizer_vendor_agreements ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizer_vendor_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id UUID NOT NULL,
  vendor_id UUID NOT NULL,
  event_id UUID NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','expired')),
  effective_from DATE NOT NULL,
  effective_until DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organizer_id, vendor_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_ova_organizer ON organizer_vendor_agreements(organizer_id);
CREATE INDEX IF NOT EXISTS idx_ova_vendor ON organizer_vendor_agreements(vendor_id);
CREATE INDEX IF NOT EXISTS idx_ova_event ON organizer_vendor_agreements(event_id);
CREATE INDEX IF NOT EXISTS idx_ova_status ON organizer_vendor_agreements(status);

-- ── 5. platform_notifications ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'success', 'action')),
  action_url TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('all', 'all_vendors', 'all_organizers', 'vendor', 'organizer')),
  target_user_id UUID,
  sent_by UUID NOT NULL REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pn_created_at ON platform_notifications(created_at DESC);

-- ── 6. notification_recipients ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES platform_notifications(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('vendor', 'organizer')),
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (notification_id, recipient_user_id, recipient_type)
);

CREATE INDEX IF NOT EXISTS idx_nr_user ON notification_recipients(recipient_user_id, recipient_type);
CREATE INDEX IF NOT EXISTS idx_nr_unread ON notification_recipients(recipient_user_id, recipient_type, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_nr_notification ON notification_recipients(notification_id);

-- ── 7. RLS / Grants (service_role has full access; anon gets nothing) ───────
ALTER TABLE organizer_vendor_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_recipients ENABLE ROW LEVEL SECURITY;
