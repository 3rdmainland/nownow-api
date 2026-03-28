-- Performance indexes for hot query paths
-- Identified via API performance audit

-- Orders: frequently queried by event_id and vendor_id
CREATE INDEX IF NOT EXISTS idx_orders_event_id ON orders (event_id);
CREATE INDEX IF NOT EXISTS idx_orders_vendor_id ON orders (vendor_id);
CREATE INDEX IF NOT EXISTS idx_orders_vendor_event ON orders (vendor_id, event_id);
CREATE INDEX IF NOT EXISTS idx_orders_vendor_status ON orders (vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);

-- Event vendors: junction table queried on every event page load
CREATE INDEX IF NOT EXISTS idx_event_vendors_event_status ON event_vendors (event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_vendors_vendor ON event_vendors (vendor_id);

-- Event menu configurations: queried for vendor status on event pages
CREATE INDEX IF NOT EXISTS idx_event_menu_configs_event ON event_menu_configurations (event_id);
CREATE INDEX IF NOT EXISTS idx_event_menu_configs_vendor_event ON event_menu_configurations (vendor_id, event_id);

-- Default menu items: queried for vendor listing previews
CREATE INDEX IF NOT EXISTS idx_default_menu_items_vendor_active ON default_menu_items (vendor_id, is_active, availability_status);
CREATE INDEX IF NOT EXISTS idx_default_menu_items_category ON default_menu_items (category_id, is_active, availability_status);

-- Vendor categories: junction table for category filtering
CREATE INDEX IF NOT EXISTS idx_vendor_categories_vendor ON vendor_categories (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_categories_category ON vendor_categories (category_id);

-- Menu categories: queried for aggregated event menu categories
CREATE INDEX IF NOT EXISTS idx_menu_categories_vendor_active ON menu_categories (vendor_id, is_active);
CREATE INDEX IF NOT EXISTS idx_menu_categories_slug ON menu_categories (slug, is_active);

-- Settlement orders: checked for already-settled orders
CREATE INDEX IF NOT EXISTS idx_settlement_orders_order ON settlement_orders (order_id);
CREATE INDEX IF NOT EXISTS idx_settlement_orders_batch ON settlement_orders (batch_id);

-- Settlement payouts: queried by vendor and batch
CREATE INDEX IF NOT EXISTS idx_settlement_payouts_vendor ON settlement_payouts (vendor_id);
CREATE INDEX IF NOT EXISTS idx_settlement_payouts_batch ON settlement_payouts (batch_id);

-- Organizer vendor agreements: queried for commission lookups
CREATE INDEX IF NOT EXISTS idx_org_vendor_agreements_vendor_event ON organizer_vendor_agreements (vendor_id, event_id, status);

-- Events: code lookups
CREATE INDEX IF NOT EXISTS idx_events_code ON events (code);
