# NowNow API Load Test Suite

## Architecture

```
load-test/
  supabase-mock.ts   -- In-memory Supabase client replacement (NO real DB calls)
  server.ts          -- Fastify server using mocked Supabase + mocked Redis
  k6-load-test.js    -- k6 test scenarios (smoke, load, stress, spike, soak)
  run.sh             -- One-command runner: starts server + runs k6
  README.md          -- This file
```

## Prerequisites

1. **Node.js** (v20+) and **tsx** (already in devDependencies)
2. **k6** load testing tool:
   ```bash
   brew install grafana/k6/k6
   ```

## Quick Start

```bash
# Smoke test (2 VUs, 30s)
./load-test/run.sh

# Normal load test (up to 50 VUs, 8 min)
./load-test/run.sh load

# Stress test (up to 300 VUs, 4 min)
./load-test/run.sh stress

# Spike test (sudden burst to 200 VUs)
./load-test/run.sh spike

# Soak test (30 VUs sustained for 10 min)
./load-test/run.sh soak
```

## Manual Usage

```bash
# Terminal 1: Start mock server
npx tsx load-test/server.ts

# Terminal 2: Run k6
k6 run --env SCENARIO=load --env BASE_URL=http://localhost:3099 load-test/k6-load-test.js
```

## Safety: No Real DB Calls

The `supabase-mock.ts` module provides a complete in-memory replacement for the
`@supabase/supabase-js` client. It supports all chainable query builder methods
(`.select()`, `.eq()`, `.insert()`, `.update()`, `.delete()`, `.single()`, etc.)
and stores data in JavaScript arrays. No HTTP requests leave the machine.

Redis is also mocked with an in-memory Map.

## Test Scenarios

| Scenario | VUs   | Duration | Purpose                                    |
|----------|-------|----------|--------------------------------------------|
| smoke    | 2     | 30s      | Verify all endpoints work                  |
| load     | 20-50 | 8 min    | Normal traffic patterns                    |
| stress   | 50-300| 4 min    | Find breaking point                        |
| spike    | 10-200| ~90s     | Sudden burst handling                      |
| soak     | 30    | 10 min   | Memory leak detection, stability           |

## User Journeys Simulated

| Journey            | Weight | Actions                                          |
|--------------------|--------|--------------------------------------------------|
| Customer browsing  | 40%    | Event lookup, vendor list, menu, categories      |
| Customer ordering  | 30%    | Browse menu, create order, check status, update  |
| Vendor dashboard   | 15%    | Login, /me, stats, orders list, logout           |
| Search             | 10%    | Vendor search, events, categories                |
| Auth flows         | 5%     | Login, /me, logout, organizer login              |

## Thresholds

- p95 response time < 500ms
- p99 response time < 1000ms
- Error rate < 5%
- Order creation p95 < 300ms
- Vendor list p95 < 200ms
- Auth login p95 < 200ms

## Endpoints Covered

### Orders
- GET /orders (filtered, paginated)
- GET /orders/recent
- GET /orders/stats
- GET /orders/:id
- POST /orders
- PATCH /orders/:id/status
- DELETE /orders/:id

### Vendors
- GET /vendor
- GET /vendor/search?q=
- GET /vendor/event/:eventId
- GET /vendor/:id
- GET /vendor/:id/stats
- GET /vendor/:id/menu

### Events
- GET /event
- GET /event/:id
- GET /event/code/:code

### Categories
- GET /category
- GET /category/:id

### Auth
- POST /auth/login
- POST /auth/logout
- GET /auth/me
- POST /organizer/auth/login

### Discounts
- GET /discount/organizer/events/:eventId

### WebSocket
- WS /ws (connect, subscribe, receive messages)
