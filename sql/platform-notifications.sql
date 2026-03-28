-- Platform Notifications System
-- Run this migration in Supabase SQL Editor

CREATE TABLE platform_notifications (
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

CREATE TABLE notification_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES platform_notifications(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('vendor', 'organizer')),
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (notification_id, recipient_user_id, recipient_type)
);

-- Indexes
CREATE INDEX idx_pn_created_at ON platform_notifications(created_at DESC);
CREATE INDEX idx_nr_user ON notification_recipients(recipient_user_id, recipient_type);
CREATE INDEX idx_nr_unread ON notification_recipients(recipient_user_id, recipient_type, is_read) WHERE is_read = false;
CREATE INDEX idx_nr_notification ON notification_recipients(notification_id);
