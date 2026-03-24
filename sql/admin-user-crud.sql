-- Admin User CRUD: add missing columns for user management
-- customers lacks is_active for suspension
-- vendor_users lacks name and is_active
-- organizer_users lacks is_active

ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE vendor_users ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '';
ALTER TABLE vendor_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE organizer_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
