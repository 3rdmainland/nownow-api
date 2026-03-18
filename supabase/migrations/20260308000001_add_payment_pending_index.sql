-- Index for finding unpaid orders (cleanup/expiry)
-- Separate migration because new enum values must be committed before use
CREATE INDEX IF NOT EXISTS idx_orders_payment_pending
ON public.orders(status) WHERE status = 'PAYMENT_PENDING'::public.order_status;
