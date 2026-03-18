-- Add PAYMENT_PENDING to the order_status enum
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'PAYMENT_PENDING' BEFORE 'PENDING';

-- Add payment tracking fields for Stitch Express integration
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS stitch_payment_id text,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'none',
ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Index for webhook lookups by stitch_payment_id
CREATE INDEX IF NOT EXISTS idx_orders_stitch_payment_id
ON public.orders(stitch_payment_id) WHERE stitch_payment_id IS NOT NULL;
