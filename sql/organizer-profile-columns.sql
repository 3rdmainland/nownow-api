-- Add profile columns to organizer_users
ALTER TABLE organizer_users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE organizer_users ADD COLUMN IF NOT EXISTS organization text;
