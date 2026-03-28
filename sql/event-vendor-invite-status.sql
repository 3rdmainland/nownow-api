-- Add invite status to event_vendors table
-- Default 'accepted' ensures backward compatibility for existing rows
ALTER TABLE event_vendors
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'accepted'
  CHECK (status IN ('invited', 'accepted', 'declined'));

CREATE INDEX IF NOT EXISTS idx_event_vendors_status
  ON event_vendors(event_id, status);
