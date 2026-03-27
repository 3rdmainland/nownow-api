-- Settlement Engine Tables
-- Run against Supabase SQL editor

-- 1. Vendor Bank Details (SA banking info)
CREATE TABLE IF NOT EXISTS vendor_bank_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL UNIQUE,
  account_holder_name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  branch_code TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('cheque', 'savings', 'transmission', 'current')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendor_bank_details_vendor_id ON vendor_bank_details(vendor_id);

-- 2. Settlement Batches
CREATE TABLE IF NOT EXISTS settlement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'settled', 'failed')),
  payout_type TEXT NOT NULL DEFAULT 'standard' CHECK (payout_type IN ('standard', 'instant')),
  payout_fee_per_vendor NUMERIC(12,2) NOT NULL DEFAULT 2.00,
  total_gross NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_service_fees NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_platform_fees NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_payout_fees NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_net NUMERIC(12,2) NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  vendor_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_settlement_batches_status ON settlement_batches(status);
CREATE INDEX idx_settlement_batches_dates ON settlement_batches(start_date, end_date);
CREATE INDEX idx_settlement_batches_created_at ON settlement_batches(created_at);

-- 3. Settlement Payouts (per-vendor payout within a batch)
CREATE TABLE IF NOT EXISTS settlement_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES settlement_batches(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL,
  vendor_name TEXT,
  gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  service_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  platform_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  payout_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'settled', 'failed')),
  payment_reference TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_settlement_payouts_batch_id ON settlement_payouts(batch_id);
CREATE INDEX idx_settlement_payouts_vendor_id ON settlement_payouts(vendor_id);
CREATE INDEX idx_settlement_payouts_status ON settlement_payouts(status);

-- 4. Settlement Orders (junction: prevents double-settlement)
CREATE TABLE IF NOT EXISTS settlement_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE,
  batch_id UUID NOT NULL REFERENCES settlement_batches(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL,
  order_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  service_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_settlement_orders_batch_id ON settlement_orders(batch_id);
CREATE INDEX idx_settlement_orders_vendor_id ON settlement_orders(vendor_id);
CREATE INDEX idx_settlement_orders_order_id ON settlement_orders(order_id);
