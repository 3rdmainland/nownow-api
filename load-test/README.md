# NowNow API Load Test Suite

## Architecture

```
load-test/
  k6-load-test.js    -- k6 test scenarios (smoke, load, stress, spike, soak)
  run.sh             -- Mocked runner: starts mock server + runs k6
  run-real.sh        -- Real DB runner: starts API against local Supabase + runs k6
  run-alb.sh         -- ALB simulator: starts N instances + round-robin proxy + runs k6
  server.ts          -- Fastify server using mocked Supabase + mocked Redis
  supabase-mock.ts   -- In-memory Supabase client replacement (NO real DB calls)
  alb-proxy.ts       -- Round-robin HTTP proxy simulating an ALB
  README.md          -- This file
  RESULTS.md         -- Performance report (gitignored, regenerate locally)
```

## Prerequisites

1. **Node.js** (v20+) and **tsx** (already in devDependencies)
2. **k6** load testing tool:
   ```bash
   brew install grafana/k6/k6
   ```
3. **Local Supabase** (for real DB and ALB tests only):
   ```bash
   supabase start
   supabase db reset   # applies migrations + seed data
   ```

## Quick Start

### Mocked (no database needed)

```bash
./load-test/run.sh              # Smoke test (default)
./load-test/run.sh load         # Normal load test
./load-test/run.sh stress       # Stress test
```

### Real Database (local Supabase)

```bash
./load-test/run-real.sh smoke   # Verify all endpoints work
./load-test/run-real.sh load    # 50 VUs, 8 min — primary benchmark
./load-test/run-real.sh stress  # 300 VUs — find breaking point
./load-test/run-real.sh spike   # 200 VUs instant burst
./load-test/run-real.sh soak    # 30 VUs, 10 min — stability test
```

### Simulated ALB (multiple instances + load balancer)

Starts N API server instances behind a round-robin proxy to simulate
horizontal scaling with an Application Load Balancer.

```
k6 → :3098 (ALB proxy) → :3101 (instance 1)
                        → :3102 (instance 2)
                        → :3103 (instance 3)
```

```bash
./load-test/run-alb.sh spike    # 3 instances (default)
./load-test/run-alb.sh stress   # 3 instances
INSTANCES=5 ./load-test/run-alb.sh stress   # 5 instances
```

All instances hit the same local Supabase Postgres — exactly like production
where multiple servers share one database.

## Manual Usage

```bash
# Terminal 1: Start mock server
npx tsx load-test/server.ts

# Terminal 2: Run k6
k6 run --env SCENARIO=load --env BASE_URL=http://localhost:3099 load-test/k6-load-test.js
```

## Test Modes

| Mode | Runner | Database | Use Case |
|------|--------|----------|----------|
| **Mocked** | `run.sh` | In-memory (no DB) | Fast iteration, CI/CD pipelines |
| **Real DB** | `run-real.sh` | Local Supabase (Postgres) | Realistic single-instance benchmarks |
| **ALB** | `run-alb.sh` | Local Supabase (Postgres) | Simulate horizontal scaling |

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

## Notes

- **Mocked mode** uses an in-memory Supabase replacement (`supabase-mock.ts`).
  No HTTP requests leave the machine. Redis is also mocked with an in-memory Map.
- **Real DB mode** connects to local Supabase (Docker). Redis is disabled (noop fallback).
  WhatsApp notifications are skipped in test mode.
- **ALB mode** runs multiple real API processes sharing one database — the same
  architecture as production behind an AWS/GCP load balancer.
