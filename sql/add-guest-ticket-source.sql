-- Add GUEST to the source CHECK constraint on support_tickets
-- This allows unauthenticated users to submit support tickets

ALTER TABLE support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_source_check;

ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_source_check
  CHECK (source IN ('CUSTOMER', 'VENDOR', 'ADMIN', 'GUEST'));
