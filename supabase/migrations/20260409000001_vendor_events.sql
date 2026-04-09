-- Vendor Events: allow vendors to create their own events and generate direct QR codes

-- 1. Add vendor feature columns
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS can_create_events boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vendor_tier varchar(10) NOT NULL DEFAULT 'standard'
    CHECK (vendor_tier IN ('standard', 'lite'));

-- 2. Add origin_type to events
-- NOTE: The spec calls this "event_type" but the DB already has an event_type column
-- (festival/concert/party/etc). We use "origin_type" to avoid collision.
-- origin_type tracks WHO created the event; event_type tracks WHAT KIND of event.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS origin_type varchar(20) NOT NULL DEFAULT 'organizer'
    CHECK (origin_type IN ('organizer', 'vendor', 'vendor_direct'));

CREATE INDEX IF NOT EXISTS idx_events_origin_type ON public.events(origin_type);

-- 3. Create vendor_events table
CREATE TABLE IF NOT EXISTS public.vendor_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  qr_code text NOT NULL,
  qr_image text NOT NULL,
  menu_template_id uuid REFERENCES public.menu_templates(id) ON DELETE SET NULL,
  is_direct boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_events_vendor_id ON public.vendor_events(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_events_event_id ON public.vendor_events(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_events_direct ON public.vendor_events(vendor_id) WHERE is_direct = true;

-- Trigger for updated_at
CREATE TRIGGER update_vendor_events_updated_at
  BEFORE UPDATE ON public.vendor_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
