-- Vendor multi-category support: junction table for many-to-many vendor ↔ category
-- Follows the existing event_vendors pattern.

-- 1. Create junction table
CREATE TABLE IF NOT EXISTS public.vendor_categories (
    vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (vendor_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_categories_vendor_id ON public.vendor_categories(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_categories_category_id ON public.vendor_categories(category_id);

-- 2. Migrate existing data from vendors.category_id into the junction table
INSERT INTO public.vendor_categories (vendor_id, category_id)
SELECT id, category_id
FROM public.vendors
WHERE category_id IS NOT NULL
ON CONFLICT (vendor_id, category_id) DO NOTHING;

-- 3. Drop FK constraint and index on vendors.category_id (keep column nullable for backwards compat)
ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_category_id_fkey;
DROP INDEX IF EXISTS idx_vendors_category_id;

-- 4. Add a comment marking the column as deprecated
COMMENT ON COLUMN public.vendors.category_id IS 'DEPRECATED: use vendor_categories junction table instead';
