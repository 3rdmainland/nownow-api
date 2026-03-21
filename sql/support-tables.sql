-- Support Tickets
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number SERIAL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('ORDER_ISSUE', 'ACCOUNT_ISSUE', 'PAYMENT_ISSUE', 'GENERAL_INQUIRY', 'VENDOR_COMPLAINT', 'EVENT_ISSUE')),
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  source TEXT NOT NULL DEFAULT 'ADMIN' CHECK (source IN ('CUSTOMER', 'VENDOR', 'ADMIN')),
  customer_phone TEXT,
  order_id UUID,
  event_id UUID,
  vendor_id UUID,
  assigned_admin_id UUID REFERENCES admin_users(id),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Start ticket numbers at 1001
ALTER SEQUENCE support_tickets_ticket_number_seq RESTART WITH 1001;

CREATE INDEX idx_support_tickets_status ON support_tickets(status);
CREATE INDEX idx_support_tickets_priority ON support_tickets(priority);
CREATE INDEX idx_support_tickets_category ON support_tickets(category);
CREATE INDEX idx_support_tickets_assigned_admin_id ON support_tickets(assigned_admin_id);
CREATE INDEX idx_support_tickets_customer_phone ON support_tickets(customer_phone);
CREATE INDEX idx_support_tickets_order_id ON support_tickets(order_id);
CREATE INDEX idx_support_tickets_created_at ON support_tickets(created_at);

-- Support Messages
CREATE TABLE support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('ADMIN', 'CUSTOMER', 'SYSTEM')),
  sender_id TEXT,
  sender_name TEXT,
  message TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_support_messages_ticket_id ON support_messages(ticket_id);
CREATE INDEX idx_support_messages_created_at ON support_messages(created_at);
