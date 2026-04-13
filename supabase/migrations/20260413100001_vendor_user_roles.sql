-- Multi-vendor RBAC: junction table for user-vendor role assignments
CREATE TABLE IF NOT EXISTS vendor_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vendor_users(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, vendor_id)
);

CREATE INDEX idx_vendor_user_roles_user ON vendor_user_roles(user_id);
CREATE INDEX idx_vendor_user_roles_vendor ON vendor_user_roles(vendor_id);

-- Staff invite tokens
CREATE TABLE IF NOT EXISTS vendor_staff_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES vendor_users(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'staff')),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_vendor_staff_invites_token ON vendor_staff_invites(token);
CREATE INDEX idx_vendor_staff_invites_email ON vendor_staff_invites(email);

-- Backfill: every existing vendor_user gets 'owner' role on their vendor
INSERT INTO vendor_user_roles (user_id, vendor_id, role)
SELECT id, vendor_id, 'owner'
FROM vendor_users
WHERE vendor_id IS NOT NULL
ON CONFLICT (user_id, vendor_id) DO NOTHING;

-- Add platform + expo_push_token + active to push_subscriptions for native push
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'web' CHECK (platform IN ('web', 'ios', 'android')),
  ADD COLUMN IF NOT EXISTS expo_push_token TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Add busy mode fields to event_menu_configurations
ALTER TABLE event_menu_configurations
  ADD COLUMN IF NOT EXISTS is_busy_mode BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS busy_mode_multiplier NUMERIC DEFAULT 2;
