/**
 * NowNow API - k6 Load Test Suite
 *
 * Comprehensive load test covering all API endpoints with mocked Supabase.
 * Run against the load-test server (load-test/server.ts), NOT production.
 *
 * Prerequisites:
 *   1. Install k6: brew install grafana/k6/k6
 *   2. Start mock server: npx tsx load-test/server.ts
 *   3. Run this test:
 *      - Smoke:   k6 run --env SCENARIO=smoke   load-test/k6-load-test.js
 *      - Load:    k6 run --env SCENARIO=load    load-test/k6-load-test.js
 *      - Stress:  k6 run --env SCENARIO=stress  load-test/k6-load-test.js
 *      - Spike:   k6 run --env SCENARIO=spike   load-test/k6-load-test.js
 *      - Soak:    k6 run --env SCENARIO=soak    load-test/k6-load-test.js
 */

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { randomItem, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ──────────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3099';
const WS_URL = BASE_URL.replace('http', 'ws') + '/ws';
const SCENARIO = __ENV.SCENARIO || 'smoke';

// Test data IDs (must match supabase-mock.ts)
const VENDOR_ID_1 = '00000000-0000-0000-0000-000000000001';
const VENDOR_ID_2 = '00000000-0000-0000-0000-000000000002';
const EVENT_ID_1 = '11111111-1111-1111-1111-111111111111';
const EVENT_ID_2 = '22222222-2222-2222-2222-222222222222';
const CATEGORY_ID_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// Custom metrics
const orderCreateDuration = new Trend('order_create_duration', true);
const vendorListDuration = new Trend('vendor_list_duration', true);
const eventMenuDuration = new Trend('event_menu_duration', true);
const authLoginDuration = new Trend('auth_login_duration', true);
const errorRate = new Rate('errors');
const ordersCreated = new Counter('orders_created');

// ──────────────────────────────────────────────────────────────────────────────
// Scenarios
// ──────────────────────────────────────────────────────────────────────────────

const scenarios = {
  // Smoke test: verify endpoints work (1-2 VUs)
  smoke: {
    executor: 'constant-vus',
    vus: 2,
    duration: '30s',
  },

  // Normal load: realistic traffic pattern
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 20 },   // Ramp up
      { duration: '3m', target: 20 },   // Steady state
      { duration: '1m', target: 50 },   // Peak load
      { duration: '2m', target: 50 },   // Sustained peak
      { duration: '1m', target: 0 },    // Ramp down
    ],
  },

  // Stress test: find breaking point
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 50 },
      { duration: '1m', target: 100 },
      { duration: '1m', target: 200 },
      { duration: '1m', target: 300 },
      { duration: '30s', target: 0 },
    ],
  },

  // Spike test: sudden burst
  spike: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '10s', target: 10 },    // Normal
      { duration: '5s', target: 200 },     // Spike!
      { duration: '30s', target: 200 },    // Sustain spike
      { duration: '10s', target: 10 },     // Back to normal
      { duration: '30s', target: 10 },     // Stabilize
      { duration: '5s', target: 0 },       // Ramp down
    ],
  },

  // Soak test: sustained load over time (detect memory leaks)
  soak: {
    executor: 'constant-vus',
    vus: 30,
    duration: '10m',
  },
};

export const options = {
  scenarios: {
    default: scenarios[SCENARIO] || scenarios.smoke,
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.05'],           // Less than 5% errors
    errors: ['rate<0.05'],
    order_create_duration: ['p(95)<300'],
    vendor_list_duration: ['p(95)<200'],
    auth_login_duration: ['p(95)<200'],
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────────────────────────────────────

const headers = { 'Content-Type': 'application/json' };

function randomPhone() {
  return '08' + String(randomIntBetween(10000000, 99999999));
}

function login() {
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    email: 'loadtest@vendor.com',
    password: 'password123',
  }), { headers });

  authLoginDuration.add(res.timings.duration);

  let token = '';
  if (res.cookies && res.cookies.token && res.cookies.token.length > 0) {
    token = res.cookies.token[0].value;
  }
  return token;
}

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Cookie': `token=${token}`,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Test scenarios (mixed workload simulating real usage)
// ──────────────────────────────────────────────────────────────────────────────

export default function () {
  // Distribute VUs across different user journeys
  const journey = randomIntBetween(1, 100);

  if (journey <= 40) {
    // 40% - Customer browsing (most common)
    customerBrowsingJourney();
  } else if (journey <= 70) {
    // 30% - Customer placing order
    customerOrderJourney();
  } else if (journey <= 85) {
    // 15% - Vendor dashboard
    vendorDashboardJourney();
  } else if (journey <= 95) {
    // 10% - Search and discovery
    searchJourney();
  } else {
    // 5% - Auth flows
    authJourney();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Journey: Customer browsing event vendors and menus
// ──────────────────────────────────────────────────────────────────────────────

function customerBrowsingJourney() {
  group('Customer Browsing', () => {
    // 1. Get event by code (landing page)
    const eventRes = http.get(`${BASE_URL}/event/code/LOADTEST1`, { headers });
    check(eventRes, {
      'event by code: 200': (r) => r.status === 200,
      'event has data': (r) => {
        try { return JSON.parse(r.body).event !== undefined; } catch { return false; }
      },
    }) ? errorRate.add(0) : errorRate.add(1);

    sleep(0.5);

    // 2. Get vendors for this event
    const vendorsRes = http.get(
      `${BASE_URL}/vendor/event/${EVENT_ID_1}?page=1&pageSize=20`,
      { headers }
    );
    check(vendorsRes, {
      'event vendors: 200': (r) => r.status === 200,
      'vendors array exists': (r) => {
        try { return Array.isArray(JSON.parse(r.body).vendors); } catch { return false; }
      },
    }) ? errorRate.add(0) : errorRate.add(1);
    vendorListDuration.add(vendorsRes.timings.duration);

    sleep(0.3);

    // 3. View vendor details
    const vendorId = randomItem([VENDOR_ID_1, VENDOR_ID_2]);
    const vendorRes = http.get(`${BASE_URL}/vendor/${vendorId}`, { headers });
    check(vendorRes, {
      'vendor detail: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);

    sleep(0.3);

    // 4. Get vendor menu
    const menuRes = http.get(`${BASE_URL}/vendor/${vendorId}/menu`, { headers });
    check(menuRes, {
      'vendor menu: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);
    eventMenuDuration.add(menuRes.timings.duration);

    sleep(0.2);

    // 5. Get categories
    const catRes = http.get(`${BASE_URL}/category`, { headers });
    check(catRes, {
      'categories: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);
  });

  sleep(randomIntBetween(1, 3));
}

// ──────────────────────────────────────────────────────────────────────────────
// Journey: Customer placing an order
// ──────────────────────────────────────────────────────────────────────────────

function customerOrderJourney() {
  group('Customer Order', () => {
    const vendorId = randomItem([VENDOR_ID_1, VENDOR_ID_2]);
    const phone = randomPhone();

    // 1. Browse menu first
    http.get(`${BASE_URL}/vendor/${vendorId}/menu`, { headers });
    sleep(0.5);

    // 2. Place order
    const orderPayload = {
      vendor_id: vendorId,
      event_id: EVENT_ID_1,
      phone: phone,
      items: [
        {
          id: crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}`,
          name: randomItem(['Burger', 'Pizza', 'Fries', 'Drink']),
          price: randomIntBetween(30, 120),
          quantity: randomIntBetween(1, 3),
          vendorId: vendorId,
          vendorName: 'Test Vendor',
          prepTime: 10,
        },
      ],
      total: randomIntBetween(30, 200),
      notes: 'Load test order',
      paymentMethod: randomItem(['CASH', 'CARD']),
    };

    const createRes = http.post(`${BASE_URL}/orders`, JSON.stringify(orderPayload), { headers });
    check(createRes, {
      'create order: 201': (r) => r.status === 201,
      'order has id': (r) => {
        try { return JSON.parse(r.body).order?.id !== undefined; } catch { return false; }
      },
    }) ? errorRate.add(0) : errorRate.add(1);
    orderCreateDuration.add(createRes.timings.duration);

    if (createRes.status === 201) {
      ordersCreated.add(1);
      const orderId = JSON.parse(createRes.body).order?.id;

      sleep(0.5);

      // 3. Check order status
      if (orderId) {
        const orderRes = http.get(`${BASE_URL}/orders/${orderId}`, { headers });
        check(orderRes, {
          'get order: 200': (r) => r.status === 200,
        }) ? errorRate.add(0) : errorRate.add(1);

        sleep(0.3);

        // 4. Update order status (simulate vendor accepting)
        const statusRes = http.patch(
          `${BASE_URL}/orders/${orderId}/status`,
          JSON.stringify({ status: 'PREPARING' }),
          { headers }
        );
        check(statusRes, {
          'update status: 200': (r) => r.status === 200,
        }) ? errorRate.add(0) : errorRate.add(1);
      }
    }

    sleep(0.3);

    // 5. Get orders by phone (customer checking their orders)
    const phoneRes = http.get(`${BASE_URL}/orders?page=1&pageSize=10`, { headers });
    check(phoneRes, {
      'list orders: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);
  });

  sleep(randomIntBetween(1, 3));
}

// ──────────────────────────────────────────────────────────────────────────────
// Journey: Vendor checking dashboard
// ──────────────────────────────────────────────────────────────────────────────

function vendorDashboardJourney() {
  group('Vendor Dashboard', () => {
    // 1. Login
    const token = login();

    if (!token) {
      errorRate.add(1);
      return;
    }

    sleep(0.3);

    // 2. Get me (validate session)
    const meRes = http.get(`${BASE_URL}/auth/me`, { headers: authHeaders(token) });
    check(meRes, {
      'auth me: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);

    sleep(0.3);

    // 3. Get vendor stats
    const statsRes = http.get(`${BASE_URL}/vendor/${VENDOR_ID_1}/stats`, { headers });
    check(statsRes, {
      'vendor stats: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);

    sleep(0.3);

    // 4. Get vendor orders
    const ordersRes = http.get(
      `${BASE_URL}/orders?vendorId=${VENDOR_ID_1}&page=1&pageSize=20`,
      { headers }
    );
    check(ordersRes, {
      'vendor orders: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);

    sleep(0.3);

    // 5. Get order stats
    const orderStatsRes = http.get(
      `${BASE_URL}/orders/stats?vendorId=${VENDOR_ID_1}&eventId=${EVENT_ID_1}`,
      { headers }
    );
    check(orderStatsRes, {
      'order stats: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);

    sleep(0.3);

    // 6. Get recent orders
    const recentRes = http.get(`${BASE_URL}/orders/recent?limit=10`, { headers });
    check(recentRes, {
      'recent orders: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);

    sleep(0.3);

    // 7. Logout
    http.post(`${BASE_URL}/auth/logout`, '{}', { headers: authHeaders(token) });
  });

  sleep(randomIntBetween(2, 5));
}

// ──────────────────────────────────────────────────────────────────────────────
// Journey: Search and discovery
// ──────────────────────────────────────────────────────────────────────────────

function searchJourney() {
  group('Search', () => {
    // 1. Search vendors
    const searchTerm = randomItem(['burger', 'pizza', 'food', 'test']);
    const searchRes = http.get(
      `${BASE_URL}/vendor/search?q=${searchTerm}`,
      { headers }
    );
    check(searchRes, {
      'vendor search: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);

    sleep(0.3);

    // 2. List events
    const eventsRes = http.get(`${BASE_URL}/event`, { headers });
    check(eventsRes, {
      'list events: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);

    sleep(0.3);

    // 3. Get event details
    const eventRes = http.get(`${BASE_URL}/event/${EVENT_ID_1}`, { headers });
    check(eventRes, {
      'event detail: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);

    sleep(0.3);

    // 4. List categories
    const catRes = http.get(`${BASE_URL}/category`, { headers });
    check(catRes, {
      'categories: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);

    sleep(0.3);

    // 5. Get category detail
    const catDetailRes = http.get(`${BASE_URL}/category/${CATEGORY_ID_1}`, { headers });
    check(catDetailRes, {
      'category detail: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);
  });

  sleep(randomIntBetween(1, 3));
}

// ──────────────────────────────────────────────────────────────────────────────
// Journey: Authentication flows
// ──────────────────────────────────────────────────────────────────────────────

function authJourney() {
  group('Auth Flow', () => {
    // 1. Login
    const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
      email: 'loadtest@vendor.com',
      password: 'password123',
    }), { headers });

    check(loginRes, {
      'login: 200': (r) => r.status === 200,
      'login returns user': (r) => {
        try { return JSON.parse(r.body).user !== undefined; } catch { return false; }
      },
    }) ? errorRate.add(0) : errorRate.add(1);
    authLoginDuration.add(loginRes.timings.duration);

    let token = '';
    if (loginRes.cookies && loginRes.cookies.token && loginRes.cookies.token.length > 0) {
      token = loginRes.cookies.token[0].value;
    }

    sleep(0.3);

    if (token) {
      // 2. Get me
      const meRes = http.get(`${BASE_URL}/auth/me`, { headers: authHeaders(token) });
      check(meRes, {
        'me: 200': (r) => r.status === 200,
      }) ? errorRate.add(0) : errorRate.add(1);

      sleep(0.3);

      // 3. Logout
      const logoutRes = http.post(`${BASE_URL}/auth/logout`, '{}', { headers: authHeaders(token) });
      check(logoutRes, {
        'logout: 200': (r) => r.status === 200,
      }) ? errorRate.add(0) : errorRate.add(1);
    }

    sleep(0.5);

    // 4. Organizer login
    const orgLoginRes = http.post(`${BASE_URL}/organizer/auth/login`, JSON.stringify({
      email: 'loadtest@organizer.com',
      password: 'password123',
    }), { headers });

    check(orgLoginRes, {
      'org login: 200': (r) => r.status === 200,
    }) ? errorRate.add(0) : errorRate.add(1);
  });

  sleep(randomIntBetween(2, 5));
}

// ──────────────────────────────────────────────────────────────────────────────
// WebSocket test (separate scenario)
// ──────────────────────────────────────────────────────────────────────────────

export function websocketTest() {
  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on('open', () => {
      // Subscribe to event updates
      socket.send(JSON.stringify({
        type: 'SUBSCRIBE',
        payload: { eventId: EVENT_ID_1, vendorId: VENDOR_ID_1 },
      }));
    });

    socket.on('message', (data) => {
      const msg = JSON.parse(data);
      check(msg, {
        'ws message has type': (m) => m.type !== undefined,
        'ws message has timestamp': (m) => m.timestamp !== undefined,
      });
    });

    socket.on('error', (e) => {
      errorRate.add(1);
    });

    // Keep connection alive for a while
    socket.setTimeout(function () {
      socket.send(JSON.stringify({ type: 'UNSUBSCRIBE' }));
      socket.close();
    }, 5000);
  });

  check(res, {
    'ws connected': (r) => r && r.status === 101,
  }) ? errorRate.add(0) : errorRate.add(1);

  sleep(1);
}

// ──────────────────────────────────────────────────────────────────────────────
// Setup and teardown
// ──────────────────────────────────────────────────────────────────────────────

export function setup() {
  // Verify server is running
  const healthRes = http.get(`${BASE_URL}/health`);
  const isHealthy = healthRes.status === 200;

  if (!isHealthy) {
    console.error(`Load test server not reachable at ${BASE_URL}. Start it with: npx tsx load-test/server.ts`);
    return { healthy: false };
  }

  const body = JSON.parse(healthRes.body);
  console.log(`Server health: ${JSON.stringify(body)}`);

  // Get test IDs
  const idsRes = http.get(`${BASE_URL}/load-test/ids`);
  const ids = JSON.parse(idsRes.body);
  console.log(`Test IDs loaded: ${ids.MENU_ITEMS?.length || 0} menu items`);

  return { healthy: true, ids };
}

export function teardown(data) {
  if (!data.healthy) {
    console.log('Tests skipped - server was not healthy');
    return;
  }
  console.log('Load test completed.');
}
