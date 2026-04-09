-- Composite index for vendor event order queries
-- Speeds up: SELECT * FROM orders WHERE vendor_id = X AND event_id IN (...) ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_vendor_event_created
  ON public.orders(vendor_id, event_id, created_at DESC);
