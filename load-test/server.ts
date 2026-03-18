/**
 * Load Test Server
 *
 * Boots the NowNow API with a MOCKED Supabase client and MOCKED Redis.
 * No real database or cache requests are made.
 *
 * Usage:
 *   npx tsx load-test/server.ts
 *
 * The server starts on port 3099 by default (configurable via LOAD_TEST_PORT).
 */

// ── Step 0: Patch env BEFORE anything else ──────────────────────────────────
process.env.JWT_SECRET = 'load-test-jwt-secret-minimum-32-chars!!';
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
process.env.UPSTASH_REDIS_REST_URL = 'https://mock-redis.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-redis-token';
process.env.NODE_ENV = 'test';
process.env.PORT = process.env.LOAD_TEST_PORT || '3099';
process.env.WA_API_VERSION = 'v18.0';
process.env.WA_PHONE_NUMBER_ID = 'mock-phone-id';
// Intentionally NOT setting WA_ACCESS_TOKEN so WhatsApp sends are skipped

// ── Step 1: Mock modules BEFORE they are imported ──────────────────────────

import { register } from 'module';
import { mockSupabaseClient, LOAD_TEST_IDS } from './supabase-mock.js';

// We will intercept the Supabase and Redis imports using a custom loader
// But since tsx doesn't support --loader well, we mock at runtime instead.

// In-memory cache for the Redis mock
const memCache = new Map<string, { value: string; expiry: number | null }>();

const redisMock = {
  get: async (key: string) => {
    const entry = memCache.get(key);
    if (!entry) return null;
    if (entry.expiry && Date.now() > entry.expiry) {
      memCache.delete(key);
      return null;
    }
    try { return JSON.parse(entry.value); } catch { return entry.value; }
  },
  set: async (key: string, value: any) => {
    memCache.set(key, { value: typeof value === 'string' ? value : JSON.stringify(value), expiry: null });
    return 'OK';
  },
  setex: async (key: string, ttl: number, value: any) => {
    memCache.set(key, {
      value: typeof value === 'string' ? value : JSON.stringify(value),
      expiry: Date.now() + ttl * 1000,
    });
    return 'OK';
  },
  del: async (...keys: string[]) => {
    let count = 0;
    for (const k of keys) { if (memCache.delete(k)) count++; }
    return count;
  },
  exists: async (key: string) => memCache.has(key) ? 1 : 0,
  ping: async () => 'PONG',
  incr: async (key: string) => {
    const entry = memCache.get(key);
    const current = entry ? parseInt(entry.value, 10) || 0 : 0;
    const next = current + 1;
    memCache.set(key, { value: String(next), expiry: entry?.expiry || null });
    return next;
  },
  expire: async (key: string, ttl: number) => {
    const entry = memCache.get(key);
    if (entry) { entry.expiry = Date.now() + ttl * 1000; return 1; }
    return 0;
  },
};

const cacheMock = {
  get: async <T>(key: string): Promise<T | null> => {
    return await redisMock.get(key) as T | null;
  },
  set: async <T>(key: string, value: T, ttl?: number): Promise<void> => {
    if (ttl) {
      await redisMock.setex(key, ttl, JSON.stringify(value));
    } else {
      await redisMock.set(key, JSON.stringify(value));
    }
  },
  del: async (...keys: string[]): Promise<void> => {
    await redisMock.del(...keys);
  },
  exists: async (key: string): Promise<boolean> => {
    return (await redisMock.exists(key)) === 1;
  },
};

// ── Step 2: Build Fastify app from scratch (don't import index.ts) ─────────

import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import { AppError } from '../src/lib/errors.js';

// We need to mock the module-level imports. The cleanest way with tsx
// is to use a dynamic import approach after patching the module.

// Since Node/tsx doesn't easily support module mocking at runtime outside of
// test frameworks, we'll take a different approach: build the server from
// scratch using the same controllers but intercepting supabase/redis.

// ─── Module interception strategy ───────────────────────────────────────────
// We use Node's Module._resolveFilename to redirect imports.
// This is a well-known runtime mocking technique for ESM/CJS hybrid.
// However, for ESM with tsx, the simplest reliable approach is:
// 1. Create wrapper files that re-export the mocks
// 2. Use --import to preload them
//
// Instead, since we control the build, we'll construct the app inline.

const PORT = parseInt(process.env.PORT || '3099', 10);

async function startLoadTestServer() {
  const fastify = Fastify({ logger: { level: 'warn' } });

  // Register core plugins
  await fastify.register(fastifyCors, { origin: '*', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
  await fastify.register(fastifyCookie);
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    cookie: { cookieName: 'token', signed: false },
  });

  // ── Decorate fastify with our mock clients ──
  // This allows route handlers to access them

  // Error handler (same as production)
  fastify.setErrorHandler((error, request, reply) => {
    if ((error as any)?.code === 'FST_ERR_VALIDATION') {
      return reply.status(400).send({ error: error.message });
    }
    if (error instanceof AppError && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    if ((error as any)?.message?.includes('Database')) {
      return reply.status(500).send({ error: 'Supabase request failed' });
    }
    return reply.status(500).send({ error: 'Internal server error' });
  });

  // ── Health check ──
  fastify.get('/health', async () => ({
    status: 'healthy',
    redis: 'mocked',
    supabase: 'mocked',
    mode: 'load-test',
    timestamp: new Date().toISOString(),
  }));

  // ── Info endpoint for load test scripts ──
  fastify.get('/load-test/ids', async () => LOAD_TEST_IDS);

  // ── Simulated endpoints that mirror the real API ──
  // These use the mock supabase client directly

  // -- Orders endpoints --
  fastify.get('/orders', async (request) => {
    const { vendorId, eventId, status, page = 1, pageSize = 20 } = request.query as any;
    const p = Math.max(1, Number(page));
    const ps = Math.min(100, Math.max(1, Number(pageSize)));
    const from = (p - 1) * ps;
    const to = from + ps - 1;

    let q = mockSupabaseClient.from('orders').select('*', { count: 'exact' });
    if (vendorId) q = q.eq('vendor_id', vendorId);
    if (eventId) q = q.eq('event_id', eventId);
    if (status) q = q.eq('status', status);
    q = q.order('created_at', { ascending: false }).range(from, to);

    const { data, count } = await q;
    const total = count || 0;
    return { orders: data || [], page: p, pageSize: ps, total, totalPages: total ? Math.ceil(total / ps) : 0 };
  });

  fastify.get('/orders/recent', async (request) => {
    const { limit = 10 } = request.query as any;
    const { data } = await mockSupabaseClient.from('orders')
      .select('*').order('created_at', { ascending: false }).limit(Number(limit));
    return { orders: data || [] };
  });

  fastify.get('/orders/stats', async (request) => {
    const { vendorId, eventId } = request.query as any;
    let q = mockSupabaseClient.from('orders').select('total, status, items, payment_method');
    if (vendorId) q = q.eq('vendor_id', vendorId);
    if (eventId) q = q.eq('event_id', eventId);
    const { data } = await q;
    const allOrders = data || [];
    const totalRevenue = allOrders.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
    return {
      totalOrders: allOrders.length,
      totalRevenue,
      averageOrderValue: allOrders.length > 0 ? totalRevenue / allOrders.length : 0,
      ordersByStatus: {},
      grossSales: totalRevenue,
      collectedRevenue: 0,
      cancelledCount: 0,
      cancelledValue: 0,
      topItem: null,
      paymentBreakdown: {},
    };
  });

  fastify.get('/orders/:id', async (request) => {
    const { id } = request.params as any;
    const { data } = await mockSupabaseClient.from('orders').select('*').eq('id', id).single();
    if (!data) return { error: 'Order not found' };
    return { order: data };
  });

  fastify.post('/orders', async (request, reply) => {
    const body = request.body as any;
    const orderData = {
      vendor_id: body.vendor_id,
      event_id: body.event_id,
      phone: body.phone,
      items: body.items || [],
      total: body.total || 0,
      status: 'PENDING',
      type: 'CART',
      estimated_prep_time: 12,
      qr_code: `ORDER:mock-${Date.now()}`,
      qr_image: 'https://mock-storage.test/qr.png',
      queue_position: 1,
      estimated_ready_time: new Date(Date.now() + 12 * 60_000).toISOString(),
      notes: body.notes || null,
      payment_method: body.paymentMethod || 'CASH',
    };

    const { data } = await mockSupabaseClient.from('orders').insert([orderData]).select('*').single();
    return reply.status(201).send({ order: data });
  });

  fastify.patch('/orders/:id/status', async (request) => {
    const { id } = request.params as any;
    const { status } = request.body as any;
    const { data } = await mockSupabaseClient.from('orders').update({ status }).eq('id', id).select('*').single();
    return { order: data };
  });

  fastify.delete('/orders/:id', async (request, reply) => {
    const { id } = request.params as any;
    await mockSupabaseClient.from('orders').delete().eq('id', id);
    return reply.status(204).send();
  });

  // -- Vendors endpoints --
  fastify.get('/vendor', async () => {
    const { data } = await mockSupabaseClient.from('vendors').select('*');
    return { vendors: data || [] };
  });

  fastify.get('/vendor/search', async (request) => {
    const { q } = request.query as any;
    const { data } = await mockSupabaseClient.from('vendors').select('*');
    const filtered = (data || []).filter((v: any) =>
      v.name.toLowerCase().includes((q || '').toLowerCase())
    );
    return { vendors: filtered };
  });

  fastify.get('/vendor/event/:eventId', async (request) => {
    const { eventId } = request.params as any;
    const { page = 1, pageSize = 20 } = request.query as any;
    const { data: eventVendors } = await mockSupabaseClient.from('event_vendors')
      .select('vendor_id').eq('event_id', eventId);
    const vendorIds = (eventVendors || []).map((ev: any) => ev.vendor_id);
    const { data: vendors } = await mockSupabaseClient.from('vendors')
      .select('*').in('id', vendorIds);
    return {
      id: eventId,
      vendors: (vendors || []).map((v: any) => ({ ...v, menu: [] })),
      page: Number(page), pageSize: Number(pageSize),
      total: vendors?.length || 0,
      totalPages: vendors?.length ? 1 : 0,
    };
  });

  fastify.get('/vendor/:id', async (request) => {
    const { id } = request.params as any;
    const { data } = await mockSupabaseClient.from('vendors').select('*').eq('id', id).single();
    if (!data) return { error: 'Vendor not found' };
    return { vendor: data };
  });

  fastify.get('/vendor/:id/stats', async (request) => {
    const { id } = request.params as any;
    const { data: allOrders } = await mockSupabaseClient.from('orders')
      .select('total, status, created_at').eq('vendor_id', id);
    return {
      totalOrders: allOrders?.length || 0,
      totalRevenue: allOrders?.reduce((s: number, o: any) => s + Number(o.total || 0), 0) || 0,
      averageRating: 0,
      todayOrders: 0,
      activeOrders: 0,
    };
  });

  fastify.get('/vendor/:id/menu', async (request) => {
    const { id } = request.params as any;
    const { data } = await mockSupabaseClient.from('default_menu_items')
      .select('*').eq('vendor_id', id).eq('available', true);
    return { menuItems: data || [] };
  });

  // -- Events endpoints --
  fastify.get('/event', async () => {
    const { data } = await mockSupabaseClient.from('events').select('*');
    return { events: data || [] };
  });

  fastify.get('/event/:id', async (request) => {
    const { id } = request.params as any;
    const { data } = await mockSupabaseClient.from('events').select('*').eq('id', id).single();
    if (!data) return { error: 'Event not found' };
    return { event: data };
  });

  fastify.get('/event/code/:code', async (request) => {
    const { code } = request.params as any;
    const { data } = await mockSupabaseClient.from('events').select('*').eq('code', code).single();
    if (!data) return { error: 'Event not found' };
    return { event: data };
  });

  // -- Categories endpoints --
  fastify.get('/category', async () => {
    const { data } = await mockSupabaseClient.from('categories').select('*');
    return { categories: data || [] };
  });

  fastify.get('/category/:id', async (request) => {
    const { id } = request.params as any;
    const { data } = await mockSupabaseClient.from('categories').select('*').eq('id', id).single();
    if (!data) return { error: 'Category not found' };
    return { category: data };
  });

  // -- Auth endpoints --
  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as any;
    // Simplified: accept any login with our test credentials
    if (email === 'loadtest@vendor.com') {
      const token = fastify.jwt.sign(
        { userId: LOAD_TEST_IDS.USER_ID_1, vendorId: LOAD_TEST_IDS.VENDOR_ID_1, email, role: 'vendor' },
        { expiresIn: '24h' }
      );
      reply.setCookie('token', token, { path: '/', httpOnly: true, maxAge: 86400 });
      return { user: { id: LOAD_TEST_IDS.USER_ID_1, vendorId: LOAD_TEST_IDS.VENDOR_ID_1, email } };
    }
    return reply.status(401).send({ error: 'Invalid email or password' });
  });

  fastify.post('/auth/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { message: 'Logged out' };
  });

  fastify.get('/auth/me', async (request, reply) => {
    try {
      await request.jwtVerify();
      const user = request.user as any;
      return { user: { id: user.userId, vendorId: user.vendorId, email: user.email } };
    } catch {
      return reply.status(401).send({ error: 'Authentication required' });
    }
  });

  // -- Organizer Auth endpoints --
  fastify.post('/organizer/auth/login', async (request, reply) => {
    const { email } = request.body as any;
    if (email === 'loadtest@organizer.com') {
      const token = fastify.jwt.sign(
        { userId: LOAD_TEST_IDS.ORGANIZER_ID_1, email, role: 'organizer' },
        { expiresIn: '24h' }
      );
      reply.setCookie('token', token, { path: '/', httpOnly: true, maxAge: 86400 });
      return { user: { id: LOAD_TEST_IDS.ORGANIZER_ID_1, email, name: 'Load Test Organizer' } };
    }
    return reply.status(401).send({ error: 'Invalid email or password' });
  });

  // -- Discount endpoints --
  fastify.get('/discount/organizer/events/:eventId', async (request) => {
    const { eventId } = request.params as any;
    const { data } = await mockSupabaseClient.from('discounts').select('*').eq('event_id', eventId);
    return data || [];
  });

  // -- WebSocket endpoint --
  // For load testing WebSocket, we register a minimal WS handler
  const websocket = await import('@fastify/websocket');
  await fastify.register(websocket.default);

  fastify.get('/ws', { websocket: true }, (socket: any) => {
    socket.send(JSON.stringify({
      type: 'CONNECTED',
      payload: { message: 'Connected to load test server' },
      timestamp: new Date().toISOString(),
    }));

    socket.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'SUBSCRIBE') {
          socket.send(JSON.stringify({
            type: 'SUBSCRIBED',
            payload: msg.payload || {},
            timestamp: new Date().toISOString(),
          }));
        }
      } catch { /* ignore bad messages */ }
    });

    socket.on('close', () => { /* cleanup */ });
  });

  fastify.get('/ws/stats', async () => ({ totalConnections: 0, connections: [] }));

  // ── Start server ──
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n=== NowNow Load Test Server ===`);
    console.log(`  Port:     ${PORT}`);
    console.log(`  Mode:     MOCKED (no real DB calls)`);
    console.log(`  Vendors:  ${LOAD_TEST_IDS.VENDOR_ID_1}, ${LOAD_TEST_IDS.VENDOR_ID_2}`);
    console.log(`  Events:   ${LOAD_TEST_IDS.EVENT_ID_1}, ${LOAD_TEST_IDS.EVENT_ID_2}`);
    console.log(`  Auth:     loadtest@vendor.com / loadtest@organizer.com`);
    console.log(`  Health:   http://localhost:${PORT}/health`);
    console.log(`  IDs:      http://localhost:${PORT}/load-test/ids`);
    console.log(`===============================\n`);
  } catch (err) {
    console.error('Failed to start load test server:', err);
    process.exit(1);
  }
}

startLoadTestServer();
