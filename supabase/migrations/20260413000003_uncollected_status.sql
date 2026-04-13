ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'UNCOLLECTED' AFTER 'COLLECTED';

CREATE INDEX IF NOT EXISTS idx_orders_ready_at ON orders (ready_at) WHERE status = 'READY';
