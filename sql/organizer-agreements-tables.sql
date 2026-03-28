-- ── Step 1: Add organizer_id to events table ──────────────────────────────────
-- Links each event to the organizer who created it.
-- Nullable for backwards-compat with existing rows; new events should always set it.
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_id UUID;
CREATE INDEX IF NOT EXISTS idx_events_organizer ON events(organizer_id);

-- ── Step 2: Organizer ↔ Vendor commission agreements (per-event) ──────────────
CREATE TABLE IF NOT EXISTS organizer_vendor_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id UUID NOT NULL,
  vendor_id UUID NOT NULL,
  event_id UUID NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL,  -- e.g. 15.00 = 15%
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
