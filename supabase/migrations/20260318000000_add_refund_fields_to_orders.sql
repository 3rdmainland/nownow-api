ALTER TABLE orders
  ADD COLUMN refund_status text NOT NULL DEFAULT 'none'
    CHECK (refund_status IN ('none', 'full', 'partial')),
  ADD COLUMN refund_amount numeric(10,2) DEFAULT NULL,
  ADD COLUMN refund_reason text DEFAULT NULL,
  ADD COLUMN refunded_at timestamptz DEFAULT NULL,
  ADD COLUMN refunded_by text DEFAULT NULL;

CREATE INDEX idx_orders_refund_status ON orders (refund_status) WHERE refund_status != 'none';
