-- Add 'lite_only' option to vendor_tier
-- lite_only = vendor only has access to lite dashboard, no standard mode

ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_vendor_tier_check;
ALTER TABLE public.vendors ADD CONSTRAINT vendors_vendor_tier_check
  CHECK (vendor_tier IN ('standard', 'lite', 'lite_only'));
