-- Add service_fee column to orders table
-- Stores the calculated service fee amount based on vendor's service_fee_percent
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS service_fee numeric(10,2) DEFAULT 0;
