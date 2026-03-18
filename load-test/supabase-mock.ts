/**
 * Runtime Supabase Mock for Load Testing
 *
 * This module replaces the real Supabase client with an in-memory mock
 * so the API server can run under load WITHOUT hitting the real database.
 *
 * It returns realistic fake data for all table operations the API uses.
 * No real HTTP requests are made to Supabase.
 */

import { randomUUID } from 'crypto';

// ──────────────────────────────────────────────────────────────────────────────
// In-memory data stores
// ──────────────────────────────────────────────────────────────────────────────

const VENDOR_ID_1 = '00000000-0000-0000-0000-000000000001';
const VENDOR_ID_2 = '00000000-0000-0000-0000-000000000002';
const EVENT_ID_1 = '11111111-1111-1111-1111-111111111111';
const EVENT_ID_2 = '22222222-2222-2222-2222-222222222222';
const CATEGORY_ID_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CATEGORY_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_ID_1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ORGANIZER_ID_1 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const now = () => new Date().toISOString();

const SEED_VENDORS = [
  {
    id: VENDOR_ID_1, name: 'LoadTest Burger Joint', description: 'Fast burgers',
    phone: '0811111111', email: 'burgers@test.com', image_url: null, logo_url: null,
    category_id: CATEGORY_ID_1, cuisine_type: ['Fast Food'], rating: 4.5,
    total_reviews: 50, location: { latitude: -33.9, longitude: 18.4, address: '1 Test St', city: 'Cape Town' },
    is_active: true, isActive: true, is_paused: false, isPaused: false,
    minimum_order: 30, service_fee_percent: 5, estimated_prep_time: 12,
    payment_methods: ['CASH', 'CARD'], hours: [],
    created_at: now(), updated_at: now(),
  },
  {
    id: VENDOR_ID_2, name: 'LoadTest Pizza Palace', description: 'Wood-fired pizza',
    phone: '0822222222', email: 'pizza@test.com', image_url: null, logo_url: null,
    category_id: CATEGORY_ID_2, cuisine_type: ['Italian'], rating: 4.8,
    total_reviews: 120, location: { latitude: -33.92, longitude: 18.42, address: '2 Test Ave', city: 'Cape Town' },
    is_active: true, isActive: true, is_paused: false, isPaused: false,
    minimum_order: 50, service_fee_percent: 3, estimated_prep_time: 15,
    payment_methods: ['CASH', 'CARD', 'SNAPSCAN'], hours: [],
    created_at: now(), updated_at: now(),
  },
];

const SEED_EVENTS = [
  {
    id: EVENT_ID_1, code: 'LOADTEST1', name: 'Load Test Festival',
    description: 'A festival for load testing', image_url: null,
    start_date: new Date(Date.now() - 2 * 3600_000).toISOString(),
    end_date: new Date(Date.now() + 24 * 3600_000).toISOString(),
    location: { latitude: -33.9, longitude: 18.4, address: '1 Fest St', city: 'Cape Town', state: 'WC', zipCode: '8001' },
    is_public: true, status: 'ACTIVE', branding: null,
    created_at: now(), updated_at: now(),
  },
  {
    id: EVENT_ID_2, code: 'LOADTEST2', name: 'Load Test Market',
    description: 'A market for load testing', image_url: null,
    start_date: new Date(Date.now() - 1 * 3600_000).toISOString(),
    end_date: new Date(Date.now() + 12 * 3600_000).toISOString(),
    location: { latitude: -33.92, longitude: 18.42, address: '2 Market Rd', city: 'Cape Town', state: 'WC', zipCode: '8002' },
    is_public: true, status: 'ACTIVE', branding: null,
    created_at: now(), updated_at: now(),
  },
];

const SEED_CATEGORIES = [
  { id: CATEGORY_ID_1, name: 'Fast Food', description: 'Quick bites', type: 'VENDOR', created_at: now(), updated_at: now() },
  { id: CATEGORY_ID_2, name: 'Pizza', description: 'Pizza category', type: 'VENDOR', created_at: now(), updated_at: now() },
];

function makeMenuItem(vendorId: string, catId: string, name: string, price: number) {
  return {
    id: randomUUID(), vendor_id: vendorId, category_id: catId,
    name, description: `Delicious ${name}`, price, base_price: price,
    image_url: null, type: 'FOOD', prep_time: 10, available: true, is_active: true,
    tags: [], created_at: now(), updated_at: now(),
  };
}

const SEED_MENU_ITEMS = [
  makeMenuItem(VENDOR_ID_1, CATEGORY_ID_1, 'Classic Burger', 65),
  makeMenuItem(VENDOR_ID_1, CATEGORY_ID_1, 'Cheese Burger', 75),
  makeMenuItem(VENDOR_ID_1, CATEGORY_ID_1, 'Loaded Fries', 45),
  makeMenuItem(VENDOR_ID_2, CATEGORY_ID_2, 'Margherita', 85),
  makeMenuItem(VENDOR_ID_2, CATEGORY_ID_2, 'Pepperoni', 95),
  makeMenuItem(VENDOR_ID_2, CATEGORY_ID_2, 'Hawaiian', 90),
];

const SEED_EVENT_VENDORS = [
  { event_id: EVENT_ID_1, vendor_id: VENDOR_ID_1 },
  { event_id: EVENT_ID_1, vendor_id: VENDOR_ID_2 },
  { event_id: EVENT_ID_2, vendor_id: VENDOR_ID_1 },
];

const SEED_EVENT_MENU_CONFIGS = [
  {
    id: randomUUID(), event_id: EVENT_ID_1, vendor_id: VENDOR_ID_1,
    is_accepting_orders: true, status: 'PUBLISHED',
    max_concurrent_orders: 50, current_active_orders: 0,
    order_cooldown_minutes: null, max_orders_per_customer_event: 10,
    prep_time_buffer_minutes: 5, event_open_time: '08:00', event_close_time: '23:00',
    operating_schedule: null, global_price_adjustment: null,
    created_at: now(), updated_at: now(),
  },
  {
    id: randomUUID(), event_id: EVENT_ID_1, vendor_id: VENDOR_ID_2,
    is_accepting_orders: true, status: 'PUBLISHED',
    max_concurrent_orders: 30, current_active_orders: 0,
    order_cooldown_minutes: null, max_orders_per_customer_event: null,
    prep_time_buffer_minutes: 3, event_open_time: '09:00', event_close_time: '22:00',
    operating_schedule: null, global_price_adjustment: null,
    created_at: now(), updated_at: now(),
  },
];

// bcryptjs hash for "password123"
const PASSWORD_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const SEED_VENDOR_USERS = [
  {
    id: USER_ID_1, vendor_id: VENDOR_ID_1, email: 'loadtest@vendor.com',
    password_hash: PASSWORD_HASH,
    created_at: now(), updated_at: now(),
  },
];

const SEED_ORGANIZER_USERS = [
  {
    id: ORGANIZER_ID_1, email: 'loadtest@organizer.com', name: 'Load Test Organizer',
    password_hash: PASSWORD_HASH,
    created_at: now(), updated_at: now(),
  },
];

// Mutable collections for orders (grow during test)
let orderCounter = 0;
const orders: any[] = [];
const discounts: any[] = [];

// ──────────────────────────────────────────────────────────────────────────────
// Query builder mock
// ──────────────────────────────────────────────────────────────────────────────

type Filter = { column: string; op: string; value: any };

function resolveTable(tableName: string): any[] {
  switch (tableName) {
    case 'vendors': return SEED_VENDORS;
    case 'events': return SEED_EVENTS;
    case 'categories': return SEED_CATEGORIES;
    case 'default_menu_items': return SEED_MENU_ITEMS;
    case 'event_vendors': return SEED_EVENT_VENDORS;
    case 'event_menu_configurations': return SEED_EVENT_MENU_CONFIGS;
    case 'orders': return orders;
    case 'discounts': return discounts;
    case 'vendor_users': return SEED_VENDOR_USERS;
    case 'organizer_users': return SEED_ORGANIZER_USERS;
    case 'vendor_invites': return [];
    case 'organizer_invites': return [];
    case 'vendor_password_resets': return [];
    case 'organizer_password_resets': return [];
    case 'menu_categories': return SEED_CATEGORIES;
    case 'modifier_groups': return [];
    case 'modifiers': return [];
    case 'menu_tags': return [];
    case 'event_menu_items': return [];
    case 'menu_templates': return [];
    case 'event_day_hours': return [];
    case 'vendor_event_hours': return [];
    default: return [];
  }
}

function applyFilter(rows: any[], filter: Filter): any[] {
  return rows.filter(row => {
    const val = row[filter.column];
    switch (filter.op) {
      case 'eq': return val === filter.value;
      case 'neq': return val !== filter.value;
      case 'gt': return val > filter.value;
      case 'gte': return val >= filter.value;
      case 'lt': return val < filter.value;
      case 'lte': return val <= filter.value;
      case 'in': return Array.isArray(filter.value) && filter.value.includes(val);
      case 'is': return val === filter.value;
      case 'ilike': {
        if (typeof val !== 'string') return false;
        const pattern = String(filter.value).replace(/%/g, '.*').replace(/_/g, '.');
        return new RegExp(pattern, 'i').test(val);
      }
      case 'contains': return Array.isArray(val) && filter.value.some((v: any) => val.includes(v));
      default: return true;
    }
  });
}

function createQueryBuilder(tableName: string) {
  let data = [...resolveTable(tableName)];
  const filters: Filter[] = [];
  let selectCols: string = '*';
  let orderCol: string | null = null;
  let orderAsc = true;
  let limitN: number | null = null;
  let rangeFrom: number | null = null;
  let rangeTo: number | null = null;
  let isSingle = false;
  let isMaybeSingle = false;
  let countMode: 'exact' | null = null;
  let headOnly = false;
  let insertData: any = null;
  let updateData: any = null;
  let upsertData: any = null;
  let deleteMode = false;

  const builder: any = {
    select(cols?: string, opts?: { count?: 'exact'; head?: boolean }) {
      if (cols) selectCols = cols;
      if (opts?.count) countMode = opts.count;
      if (opts?.head) headOnly = true;
      return builder;
    },
    insert(rows: any[]) {
      insertData = Array.isArray(rows) ? rows : [rows];
      return builder;
    },
    update(d: any) {
      updateData = d;
      return builder;
    },
    upsert(rows: any, _opts?: any) {
      upsertData = Array.isArray(rows) ? rows : [rows];
      return builder;
    },
    delete() {
      deleteMode = true;
      return builder;
    },
    eq(col: string, val: any) { filters.push({ column: col, op: 'eq', value: val }); return builder; },
    neq(col: string, val: any) { filters.push({ column: col, op: 'neq', value: val }); return builder; },
    gt(col: string, val: any) { filters.push({ column: col, op: 'gt', value: val }); return builder; },
    gte(col: string, val: any) { filters.push({ column: col, op: 'gte', value: val }); return builder; },
    lt(col: string, val: any) { filters.push({ column: col, op: 'lt', value: val }); return builder; },
    lte(col: string, val: any) { filters.push({ column: col, op: 'lte', value: val }); return builder; },
    in(col: string, vals: any[]) { filters.push({ column: col, op: 'in', value: vals }); return builder; },
    is(col: string, val: any) { filters.push({ column: col, op: 'is', value: val }); return builder; },
    ilike(col: string, val: any) { filters.push({ column: col, op: 'ilike', value: val }); return builder; },
    contains(col: string, val: any) { filters.push({ column: col, op: 'contains', value: val }); return builder; },
    not(_col: string, _op: string, _val: any) { return builder; },
    or(_expr: string) { return builder; },
    filter(_col: string, _op: string, _val: any) { return builder; },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col;
      orderAsc = opts?.ascending ?? true;
      return builder;
    },
    limit(n: number) { limitN = n; return builder; },
    range(from: number, to: number) { rangeFrom = from; rangeTo = to; return builder; },
    single() {
      isSingle = true;
      return builder._resolve();
    },
    maybeSingle() {
      isMaybeSingle = true;
      return builder._resolve();
    },

    _resolve(): Promise<any> {
      return new Promise((resolve) => {
        // INSERT
        if (insertData) {
          const inserted = insertData.map((row: any) => ({
            id: randomUUID(),
            ...row,
            created_at: row.created_at || now(),
            updated_at: now(),
          }));

          // Add to in-memory store
          if (tableName === 'orders') {
            orders.push(...inserted);
          }

          if (isSingle || isMaybeSingle) {
            return resolve({ data: inserted[0], error: null });
          }
          return resolve({ data: inserted, error: null, count: inserted.length });
        }

        // UPSERT
        if (upsertData) {
          const upserted = upsertData.map((row: any) => ({
            id: randomUUID(),
            ...row,
            updated_at: now(),
          }));
          if (isSingle || isMaybeSingle) {
            return resolve({ data: upserted[0], error: null });
          }
          return resolve({ data: upserted, error: null, count: upserted.length });
        }

        // Apply filters
        let result = data;
        for (const f of filters) {
          result = applyFilter(result, f);
        }

        // UPDATE
        if (updateData) {
          for (const row of result) {
            Object.assign(row, updateData, { updated_at: now() });
          }
          if (isSingle || isMaybeSingle) {
            return resolve({ data: result[0] || null, error: result.length ? null : { code: 'PGRST116', message: 'Not found' } });
          }
          return resolve({ data: result, error: null, count: result.length });
        }

        // DELETE
        if (deleteMode) {
          if (tableName === 'orders') {
            const idsToDelete = new Set(result.map(r => r.id));
            const idx = orders.findIndex(o => idsToDelete.has(o.id));
            if (idx >= 0) orders.splice(idx, 1);
          }
          if (isSingle || isMaybeSingle) {
            return resolve({ data: result[0] || null, error: null });
          }
          return resolve({ data: result, error: null });
        }

        // ORDER
        if (orderCol) {
          result.sort((a, b) => {
            const av = a[orderCol!], bv = b[orderCol!];
            if (av < bv) return orderAsc ? -1 : 1;
            if (av > bv) return orderAsc ? 1 : -1;
            return 0;
          });
        }

        const totalCount = result.length;

        // RANGE
        if (rangeFrom !== null && rangeTo !== null) {
          result = result.slice(rangeFrom, rangeTo + 1);
        }

        // LIMIT
        if (limitN !== null) {
          result = result.slice(0, limitN);
        }

        // HEAD (count only)
        if (headOnly) {
          return resolve({ data: null, error: null, count: totalCount });
        }

        // SINGLE
        if (isSingle) {
          if (result.length === 0) {
            return resolve({ data: null, error: { code: 'PGRST116', message: 'No rows found' } });
          }
          return resolve({ data: result[0], error: null });
        }

        if (isMaybeSingle) {
          return resolve({ data: result[0] || null, error: null });
        }

        return resolve({ data: result, error: null, count: countMode === 'exact' ? totalCount : undefined });
      });
    },

    // Make thenable for `await supabase.from(...).select(...)`
    then(onFulfilled: (val: any) => any, onRejected?: (err: any) => any) {
      return builder._resolve().then(onFulfilled, onRejected);
    },
  };

  return builder;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mock Supabase client
// ──────────────────────────────────────────────────────────────────────────────

export const mockSupabaseClient = {
  from(table: string) {
    return createQueryBuilder(table);
  },
  storage: {
    from(_bucket: string) {
      return {
        upload: async () => ({ data: { path: 'loadtest/qr.png' }, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://mock-storage.test/qr.png' } }),
      };
    },
  },
  rpc: async () => ({ data: null, error: null }),
};

// Export IDs for use in load test scripts
export const LOAD_TEST_IDS = {
  VENDOR_ID_1,
  VENDOR_ID_2,
  EVENT_ID_1,
  EVENT_ID_2,
  CATEGORY_ID_1,
  CATEGORY_ID_2,
  USER_ID_1,
  ORGANIZER_ID_1,
  MENU_ITEMS: SEED_MENU_ITEMS.map(i => ({ id: i.id, vendorId: i.vendor_id, name: i.name, price: i.price })),
};

// Function to reset state between test runs
export function resetMockState() {
  orders.length = 0;
  discounts.length = 0;
  orderCounter = 0;
}
