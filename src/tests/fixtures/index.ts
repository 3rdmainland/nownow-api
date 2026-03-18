// ── Vendor ──────────────────────────────────────────────────────────────────
export const makeVendor = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  name: 'Test Vendor',
  description: 'A test vendor',
  phone: '0812345678',
  email: 'vendor@test.com',
  image_url: null,
  logo_url: null,
  category_id: null,
  vendor_categories: [],
  cuisine_type: ['Fast Food'],
  rating: 4.5,
  total_reviews: 10,
  location: 'Cape Town',
  is_active: true,
  is_paused: false,
  minimum_order: 50,
  service_fee_percent: 5,
  estimated_prep_time: 15,
  payment_methods: ['CASH'],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

// ── Vendor User ──────────────────────────────────────────────────────────────
export const makeVendorUser = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  vendor_id: crypto.randomUUID(),
  email: 'user@test.com',
  password_hash: '$2b$10$hashedpassword',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

// ── Invite ───────────────────────────────────────────────────────────────────
export const makeInvite = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  vendor_id: crypto.randomUUID(),
  email: 'invite@test.com',
  token: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8),
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  used_at: null,
  created_at: new Date().toISOString(),
  ...overrides,
});

// ── Event ────────────────────────────────────────────────────────────────────
export const makeEvent = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  code: 'TEST123',
  name: 'Test Event',
  description: 'A test event',
  image_url: null,
  start_date: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
  end_date: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(), // 5 hours from now
  location: {
    latitude: -33.9249,
    longitude: 18.4241,
    address: '1 Convention Square',
    city: 'Cape Town',
    state: 'WC',
    zipCode: '8001',
  },
  is_public: true,
  status: 'ACTIVE',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

// ── Order ────────────────────────────────────────────────────────────────────
export const makeOrder = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  vendor_id: crypto.randomUUID(),
  event_id: crypto.randomUUID(),
  phone: '0812345678',
  items: [
    { id: crypto.randomUUID(), name: 'Burger', price: 80, quantity: 1, vendorId: crypto.randomUUID(), vendorName: 'Test Vendor', prepTime: 10 },
  ],
  total: 80,
  status: 'PENDING',
  type: 'CART',
  qr_code: 'ORDER:' + crypto.randomUUID(),
  qr_image: 'https://storage.test/qr.png',
  notes: null,
  payment_method: 'CASH',
  estimated_prep_time: 10,
  created_at: new Date().toISOString(),
  collected_at: null,
  prepared_at: null,
  ready_at: null,
  scheduled_pickup_time: null,
  actual_prep_time: null,
  queue_position: 1,
  estimated_ready_time: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  refund_status: 'none',
  refund_amount: null,
  refund_reason: null,
  refunded_at: null,
  refunded_by: null,
  ...overrides,
});

// ── Menu Item ────────────────────────────────────────────────────────────────
export const makeMenuItem = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  vendor_id: crypto.randomUUID(),
  category_id: null,
  name: 'Burger',
  description: 'Juicy beef burger',
  price: 80,
  image_url: null,
  type: 'FOOD',
  prep_time: 10,
  available: true,
  tags: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

// ── Category ─────────────────────────────────────────────────────────────────
export const makeCategory = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  name: 'Fast Food',
  description: 'Quick service food',
  type: 'VENDOR',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

// ── Discount ─────────────────────────────────────────────────────────────────
export const makeDiscount = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  event_id: crypto.randomUUID(),
  vendor_id: null,
  scope: 'EVENT',
  type: 'PERCENTAGE',
  value: 10,
  target_item_ids: [],
  created_by: 'ORGANIZER',
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

// ── Organizer User ───────────────────────────────────────────────────────────
export const makeOrganizerUser = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  email: 'organizer@test.com',
  name: 'Test Organizer',
  password_hash: '$2b$10$hashedpassword',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

// ── Event Menu Configuration ─────────────────────────────────────────────────
export const makeEventMenuConfig = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  event_id: crypto.randomUUID(),
  vendor_id: crypto.randomUUID(),
  is_accepting_orders: true,
  status: 'ACTIVE',
  max_concurrent_orders: 50,
  order_cooldown_minutes: 0,
  max_orders_per_customer_event: 5,
  event_open_time: '08:00',
  event_close_time: '22:00',
  prep_time_buffer_minutes: 5,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});
