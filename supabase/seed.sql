-- ============================================================================
-- NowNow API - Seed Data for Local Supabase
-- Matches load-test IDs + extra bulk data for realistic load testing
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- Storage bucket for QR codes
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('order-qrcodes', 'order-qrcodes', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY IF NOT EXISTS "Allow service role uploads" ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'order-qrcodes')
  WITH CHECK (bucket_id = 'order-qrcodes');

-- ──────────────────────────────────────────────────────────────────────────────
-- Categories (6 categories for variety)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO categories (id, name, description, type) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fast Food', 'Quick bites and burgers', 'VENDOR'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Pizza', 'Pizza and Italian', 'VENDOR'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab', 'African Cuisine', 'Traditional African dishes', 'VENDOR'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac', 'Beverages', 'Drinks and smoothies', 'VENDOR'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaad', 'Desserts', 'Sweet treats', 'VENDOR'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaae', 'Grills', 'BBQ and grilled meats', 'VENDOR');

-- ──────────────────────────────────────────────────────────────────────────────
-- Vendors (10 vendors — 2 required by load test + 8 extra)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO vendors (id, name, description, email, phone, category_id, cuisine_type, rating, total_reviews, location, is_active, is_paused, minimum_order, service_fee_percent, estimated_prep_time, payment_methods, hours) VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'LoadTest Burger Joint', 'Fast burgers and loaded fries',
    'burgers@test.com', '0811111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['Fast Food'], 4.5, 50,
    '{"latitude": -33.9, "longitude": 18.4, "address": "1 Test St", "city": "Cape Town", "state": "WC", "zipCode": "8001"}'::jsonb,
    true, false, 30, 5, 12, ARRAY['CASH', 'CARD'], '[]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'LoadTest Pizza Palace', 'Wood-fired pizza',
    'pizza@test.com', '0822222222',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ARRAY['Italian'], 4.8, 120,
    '{"latitude": -33.92, "longitude": 18.42, "address": "2 Test Ave", "city": "Cape Town", "state": "WC", "zipCode": "8002"}'::jsonb,
    true, false, 50, 3, 15, ARRAY['CASH', 'CARD', 'SNAPSCAN'], '[]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'Mama Nkechi Kitchen', 'Authentic Nigerian food',
    'nkechi@test.com', '0833333333',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab',
    ARRAY['Nigerian', 'West African'], 4.7, 85,
    '{"latitude": -33.91, "longitude": 18.41, "address": "3 Long St", "city": "Cape Town", "state": "WC", "zipCode": "8001"}'::jsonb,
    true, false, 40, 4, 20, ARRAY['CASH', 'CARD'], '[]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    'Smokey Braai Bros', 'Best braai in town',
    'braai@test.com', '0844444444',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaae',
    ARRAY['BBQ', 'South African'], 4.3, 67,
    '{"latitude": -33.93, "longitude": 18.43, "address": "4 Braai Ln", "city": "Cape Town", "state": "WC", "zipCode": "8001"}'::jsonb,
    true, false, 60, 5, 25, ARRAY['CASH', 'CARD'], '[]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000005',
    'Fresh Juice Bar', 'Cold-pressed juices and smoothies',
    'juice@test.com', '0855555555',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac',
    ARRAY['Beverages', 'Healthy'], 4.6, 200,
    '{"latitude": -33.89, "longitude": 18.39, "address": "5 Green St", "city": "Cape Town", "state": "WC", "zipCode": "8001"}'::jsonb,
    true, false, 20, 3, 5, ARRAY['CASH', 'CARD', 'SNAPSCAN'], '[]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000006',
    'Waffle House SA', 'Sweet and savoury waffles',
    'waffles@test.com', '0866666666',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaad',
    ARRAY['Desserts'], 4.4, 45,
    '{"latitude": -33.88, "longitude": 18.44, "address": "6 Sweet Ave", "city": "Cape Town", "state": "WC", "zipCode": "8001"}'::jsonb,
    true, false, 25, 4, 8, ARRAY['CASH', 'CARD'], '[]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000007',
    'Chicken Republic', 'Flame-grilled chicken',
    'chicken@test.com', '0877777777',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['Fast Food', 'Chicken'], 4.2, 150,
    '{"latitude": -33.94, "longitude": 18.38, "address": "7 Wing Rd", "city": "Cape Town", "state": "WC", "zipCode": "8001"}'::jsonb,
    true, false, 35, 5, 15, ARRAY['CASH', 'CARD'], '[]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000008',
    'Suya Spot', 'Spicy suya and grills',
    'suya@test.com', '0888888888',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaae',
    ARRAY['Nigerian', 'BBQ'], 4.9, 300,
    '{"latitude": -33.87, "longitude": 18.45, "address": "8 Spice St", "city": "Cape Town", "state": "WC", "zipCode": "8001"}'::jsonb,
    true, false, 30, 3, 10, ARRAY['CASH', 'CARD', 'SNAPSCAN'], '[]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000009',
    'Pasta Mama', 'Fresh handmade pasta',
    'pasta@test.com', '0899999999',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ARRAY['Italian', 'Pasta'], 4.6, 90,
    '{"latitude": -33.86, "longitude": 18.46, "address": "9 Noodle Way", "city": "Cape Town", "state": "WC", "zipCode": "8001"}'::jsonb,
    true, false, 55, 4, 18, ARRAY['CASH', 'CARD'], '[]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-00000000000a',
    'Boba Tea Lounge', 'Bubble tea and Asian drinks',
    'boba@test.com', '0801010101',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac',
    ARRAY['Beverages', 'Asian'], 4.7, 180,
    '{"latitude": -33.85, "longitude": 18.47, "address": "10 Bubble Ln", "city": "Cape Town", "state": "WC", "zipCode": "8001"}'::jsonb,
    true, false, 15, 3, 5, ARRAY['CASH', 'CARD', 'SNAPSCAN'], '[]'::jsonb
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- Events (4 events — 2 required by load test + 2 extra)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO events (id, name, description, code, start_date, end_date, location, is_public, status, timezone) VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Load Test Festival', 'A festival for load testing',
    'LOADTEST1',
    NOW() - INTERVAL '2 hours', NOW() + INTERVAL '24 hours',
    '{"latitude": -33.9, "longitude": 18.4, "address": "1 Fest St", "city": "Cape Town", "state": "WC", "zipCode": "8001"}'::jsonb,
    true, 'ACTIVE', 'Africa/Johannesburg'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Load Test Market', 'A market for load testing',
    'LOADTEST2',
    NOW() - INTERVAL '1 hour', NOW() + INTERVAL '12 hours',
    '{"latitude": -33.92, "longitude": 18.42, "address": "2 Market Rd", "city": "Cape Town", "state": "WC", "zipCode": "8002"}'::jsonb,
    true, 'ACTIVE', 'Africa/Johannesburg'
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Cape Town Food Fest', 'Annual food festival',
    'CTFOOD2026',
    NOW() - INTERVAL '3 hours', NOW() + INTERVAL '48 hours',
    '{"latitude": -33.95, "longitude": 18.5, "address": "100 V&A Waterfront", "city": "Cape Town", "state": "WC", "zipCode": "8001"}'::jsonb,
    true, 'ACTIVE', 'Africa/Johannesburg'
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'Jozi Night Market', 'Street food after dark',
    'JOZNIGHT',
    NOW() - INTERVAL '1 hour', NOW() + INTERVAL '6 hours',
    '{"latitude": -26.2, "longitude": 28.04, "address": "1 Maboneng Precinct", "city": "Johannesburg", "state": "GP", "zipCode": "2094"}'::jsonb,
    true, 'ACTIVE', 'Africa/Johannesburg'
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- Event Vendors (spread vendors across events)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO event_vendors (event_id, vendor_id) VALUES
  -- Load Test Festival (6 vendors)
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000005'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000006'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000008'),
  -- Load Test Market
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000004'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000007'),
  -- Cape Town Food Fest (8 vendors)
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000002'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000003'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000004'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000005'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000006'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000007'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000008'),
  -- Jozi Night Market
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000003'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000004'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000008'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000a');

-- ──────────────────────────────────────────────────────────────────────────────
-- Menu Categories (per vendor)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO menu_categories (id, vendor_id, name, slug, display_order, is_active) VALUES
  -- Vendor 1 (Burgers)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', '00000000-0000-0000-0000-000000000001', 'Burgers', 'burgers', 1, true),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', '00000000-0000-0000-0000-000000000001', 'Sides', 'sides', 2, true),
  -- Vendor 2 (Pizza)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', '00000000-0000-0000-0000-000000000002', 'Pizzas', 'pizzas', 1, true),
  -- Vendor 3 (Nigerian)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04', '00000000-0000-0000-0000-000000000003', 'Main Dishes', 'main-dishes', 1, true),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee05', '00000000-0000-0000-0000-000000000003', 'Soups', 'soups', 2, true),
  -- Vendor 4 (Braai)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee06', '00000000-0000-0000-0000-000000000004', 'Grills', 'grills', 1, true),
  -- Vendor 5 (Juice)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee07', '00000000-0000-0000-0000-000000000005', 'Juices', 'juices', 1, true),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee08', '00000000-0000-0000-0000-000000000005', 'Smoothies', 'smoothies', 2, true),
  -- Vendor 6 (Waffles)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09', '00000000-0000-0000-0000-000000000006', 'Waffles', 'waffles', 1, true),
  -- Vendor 7 (Chicken)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee0a', '00000000-0000-0000-0000-000000000007', 'Chicken', 'chicken', 1, true),
  -- Vendor 8 (Suya)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee0b', '00000000-0000-0000-0000-000000000008', 'Suya', 'suya', 1, true);

-- ──────────────────────────────────────────────────────────────────────────────
-- Default Menu Items (new menu system)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO default_menu_items (id, vendor_id, category_id, name, slug, description, type, base_price, prep_time, availability_status, is_active) VALUES
  -- Vendor 1
  ('dd000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'Classic Burger', 'classic-burger', 'Juicy beef patty with fresh toppings', 'FOOD', 65, 10, 'AVAILABLE', true),
  ('dd000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'Cheese Burger', 'cheese-burger', 'Classic with melted cheddar', 'FOOD', 75, 10, 'AVAILABLE', true),
  ('dd000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'Loaded Fries', 'loaded-fries', 'Fries with cheese and bacon', 'FOOD', 45, 8, 'AVAILABLE', true),
  ('dd000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'Double Smash Burger', 'double-smash-burger', 'Two patties, double cheese', 'FOOD', 95, 12, 'AVAILABLE', true),
  -- Vendor 2
  ('dd000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'Margherita', 'margherita', 'Classic tomato and mozzarella', 'FOOD', 85, 12, 'AVAILABLE', true),
  ('dd000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'Pepperoni', 'pepperoni', 'Spicy pepperoni with mozzarella', 'FOOD', 95, 12, 'AVAILABLE', true),
  ('dd000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'Hawaiian', 'hawaiian', 'Ham and pineapple', 'FOOD', 90, 12, 'AVAILABLE', true),
  -- Vendor 3 (Nigerian)
  ('dd000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000003', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04', 'Jollof Rice', 'jollof-rice', 'Party jollof with chicken', 'FOOD', 80, 15, 'AVAILABLE', true),
  ('dd000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000003', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee05', 'Pounded Yam & Egusi', 'pounded-yam-egusi', 'With assorted meat', 'FOOD', 95, 20, 'AVAILABLE', true),
  ('dd000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000003', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04', 'Suya Platter', 'suya-platter', 'Spicy grilled beef skewers', 'FOOD', 70, 12, 'AVAILABLE', true),
  -- Vendor 4 (Braai)
  ('dd000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee06', 'Boerewors Roll', 'boerewors-roll', 'Classic SA boerewors', 'FOOD', 55, 10, 'AVAILABLE', true),
  ('dd000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000004', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee06', 'Braai Platter', 'braai-platter', 'Steak, chops, wors, sides', 'FOOD', 150, 25, 'AVAILABLE', true),
  -- Vendor 5 (Juice)
  ('dd000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000005', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee07', 'Green Detox', 'green-detox', 'Spinach, apple, ginger', 'BEVERAGE', 45, 3, 'AVAILABLE', true),
  ('dd000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000005', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee08', 'Berry Blast', 'berry-blast', 'Mixed berries smoothie', 'BEVERAGE', 50, 3, 'AVAILABLE', true),
  -- Vendor 8 (Suya)
  ('dd000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000008', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee0b', 'Beef Suya', 'beef-suya', 'Classic spiced beef', 'FOOD', 60, 8, 'AVAILABLE', true),
  ('dd000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000008', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee0b', 'Chicken Suya', 'chicken-suya', 'Spiced chicken skewers', 'FOOD', 55, 8, 'AVAILABLE', true);

-- ──────────────────────────────────────────────────────────────────────────────
-- Event Menu Configurations
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO event_menu_configurations (id, event_id, vendor_id, is_accepting_orders, status, max_concurrent_orders, current_active_orders, max_orders_per_customer_event, prep_time_buffer_minutes, event_open_time, event_close_time) VALUES
  ('aabb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', true, 'PUBLISHED', 50, 0, 10, 5, '00:00', '23:59'),
  ('aabb0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', true, 'PUBLISHED', 30, 0, null, 3, '00:00', '23:59'),
  ('aabb0000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003', true, 'PUBLISHED', 40, 0, 8, 5, '00:00', '23:59'),
  ('aabb0000-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', true, 'PUBLISHED', 60, 0, 15, 5, '00:00', '23:59'),
  ('aabb0000-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000002', true, 'PUBLISHED', 40, 0, null, 3, '00:00', '23:59'),
  ('aabb0000-0000-0000-0000-000000000006', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000008', true, 'PUBLISHED', 50, 0, 20, 2, '00:00', '23:59');

-- ──────────────────────────────────────────────────────────────────────────────
-- Event Menu Items (link default_menu_items to events)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO event_menu_items (id, event_id, vendor_id, default_menu_item_id, is_included) VALUES
  -- Festival: Vendor 1
  ('ee000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', true),
  ('ee000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000002', true),
  ('ee000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000003', true),
  -- Festival: Vendor 2
  ('ee000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000004', true),
  ('ee000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000005', true),
  ('ee000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000006', true),
  -- Festival: Vendor 3 (Nigerian)
  ('ee000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003', 'dd000000-0000-0000-0000-000000000020', true),
  ('ee000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003', 'dd000000-0000-0000-0000-000000000021', true),
  -- CT Food Fest: Vendor 8 (Suya)
  ('ee000000-0000-0000-0000-000000000009', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000008', 'dd000000-0000-0000-0000-000000000060', true),
  ('ee000000-0000-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000008', 'dd000000-0000-0000-0000-000000000061', true);

-- ──────────────────────────────────────────────────────────────────────────────
-- Vendor Users (password: "password123")
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO vendor_users (id, vendor_id, email, password_hash) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0000-0000-000000000001', 'loadtest@vendor.com', '$2a$10$MbmNRNuugAmi2c8wRrB9qe5RRC7OkKFfUPbvOAT70u1i58o86Xxmu'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccd', '00000000-0000-0000-0000-000000000002', 'pizza@vendor.com', '$2a$10$MbmNRNuugAmi2c8wRrB9qe5RRC7OkKFfUPbvOAT70u1i58o86Xxmu'),
  ('cccccccc-cccc-cccc-cccc-ccccccccccce', '00000000-0000-0000-0000-000000000003', 'nkechi@vendor.com', '$2a$10$MbmNRNuugAmi2c8wRrB9qe5RRC7OkKFfUPbvOAT70u1i58o86Xxmu');

-- ──────────────────────────────────────────────────────────────────────────────
-- Organizer Users (password: "password123")
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO organizer_users (id, email, name, password_hash) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'loadtest@organizer.com', 'Load Test Organizer', '$2a$10$MbmNRNuugAmi2c8wRrB9qe5RRC7OkKFfUPbvOAT70u1i58o86Xxmu');

-- ──────────────────────────────────────────────────────────────────────────────
-- Event Day Hours
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO event_day_hours (id, event_id, date, open_time, close_time) VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', CURRENT_DATE, '00:00', '23:59'),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', CURRENT_DATE, '00:00', '23:59'),
  (gen_random_uuid(), '33333333-3333-3333-3333-333333333333', CURRENT_DATE, '00:00', '23:59'),
  (gen_random_uuid(), '44444444-4444-4444-4444-444444444444', CURRENT_DATE, '00:00', '23:59');

-- ──────────────────────────────────────────────────────────────────────────────
-- Vendor Event Hours
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO vendor_event_hours (id, event_id, vendor_id, date, open_time, close_time) VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', CURRENT_DATE, '00:00', '23:59'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', CURRENT_DATE, '00:00', '23:59'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003', CURRENT_DATE, '00:00', '23:59'),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', CURRENT_DATE, '00:00', '23:59'),
  (gen_random_uuid(), '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', CURRENT_DATE, '00:00', '23:59'),
  (gen_random_uuid(), '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000008', CURRENT_DATE, '00:00', '23:59');

-- ──────────────────────────────────────────────────────────────────────────────
-- Discounts (some active discounts for realism)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO discounts (id, event_id, vendor_id, scope, type, value, is_active, created_by) VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'EVENT', 'PERCENTAGE', 10, true, 'ORGANIZER'),
  (gen_random_uuid(), '33333333-3333-3333-3333-333333333333', null, 'EVENT', 'PERCENTAGE', 15, true, 'ORGANIZER'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', 'ITEM', 'FIXED', 20, true, 'VENDOR');

-- ──────────────────────────────────────────────────────────────────────────────
-- Pre-seeded orders (50 orders for realistic stats queries)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  i integer;
  v_id uuid;
  v_status order_status;
  v_type order_type;
  v_total numeric;
  statuses order_status[] := ARRAY['PENDING', 'PREPARING', 'READY', 'COLLECTED']::order_status[];
  vendors uuid[] := ARRAY['00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000003'::uuid];
BEGIN
  FOR i IN 1..50 LOOP
    v_id := vendors[1 + (i % 3)];
    v_status := statuses[1 + (i % 4)];
    v_type := CASE WHEN v_status = 'COLLECTED'::order_status THEN 'ORDER'::order_type ELSE 'CART'::order_type END;
    v_total := 60 + (random() * 140)::numeric(10,2);

    INSERT INTO orders (id, vendor_id, event_id, phone, items, total, status, type, qr_code, notes, payment_method, created_at)
    VALUES (
      gen_random_uuid(),
      v_id,
      '11111111-1111-1111-1111-111111111111',
      '08' || lpad((10000000 + floor(random() * 89999999))::text, 8, '0'),
      json_build_array(json_build_object(
        'id', gen_random_uuid(),
        'name', (ARRAY['Burger', 'Pizza', 'Jollof', 'Fries', 'Suya'])[1 + (i % 5)],
        'price', v_total,
        'quantity', 1 + (i % 3)
      ))::jsonb,
      v_total,
      v_status,
      v_type,
      'ORDER:seed-' || i || '-' || gen_random_uuid(),
      CASE WHEN i % 3 = 0 THEN 'Extra spicy please' ELSE null END,
      (ARRAY['CASH', 'CARD'])[1 + (i % 2)],
      NOW() - (i || ' minutes')::interval
    );
  END LOOP;
END $$;
