import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../helpers/app.js';

// ── Module mocks ────────────────────────────────────────────────────────────

const invalidateCacheMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../vendor/vendor.service.js', () => ({
  VendorService: vi.fn(function () {
    return {
      invalidateCache: invalidateCacheMock,
    };
  }),
}));

vi.mock('../../lib/redis.js', () => ({
  default: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  },
  CACHE_TTL: { VENDOR_LIST: 3600, VENDOR_DETAILS: 60, MENU_ITEMS: 300 },
}));

vi.mock('../../lib/supabase.js', () => ({
  supabase: { from: vi.fn() },
  safeQuery: (fn: any) => fn(),
  CircuitOpenError: class CircuitOpenError extends Error {},
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import webhookController from '../../vendor/webhook.controller.js';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Webhook Controller — Integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    invalidateCacheMock.mockResolvedValue(undefined);

    app = await buildApp(async (fastify) => {
      await fastify.register(webhookController, { prefix: '/webhooks' });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /webhooks/vendor-updated ──────────────────────────────────────

  describe('POST /webhooks/vendor-updated', () => {
    it('returns 200 with success when record.id is present (INSERT/UPDATE)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/vendor-updated',
        payload: {
          type: 'UPDATE',
          record: { id: 'vendor-123', name: 'Updated Vendor' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.vendorId).toBe('vendor-123');
      expect(invalidateCacheMock).toHaveBeenCalledWith('vendor-123');
    });

    it('uses old_record.id for DELETE events when record is absent', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/vendor-updated',
        payload: {
          type: 'DELETE',
          old_record: { id: 'vendor-deleted' },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().vendorId).toBe('vendor-deleted');
      expect(invalidateCacheMock).toHaveBeenCalledWith('vendor-deleted');
    });

    it('returns 400 when neither record nor old_record has an id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/vendor-updated',
        payload: { type: 'UPDATE' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().success).toBe(false);
      expect(res.json().error).toContain('Missing vendor ID');
    });

    it('returns 500 when invalidateCache throws', async () => {
      invalidateCacheMock.mockRejectedValue(new Error('Redis down'));

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/vendor-updated',
        payload: {
          type: 'UPDATE',
          record: { id: 'vendor-err' },
        },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().success).toBe(false);
      expect(res.json().error).toContain('Failed to process webhook');
    });
  });

  // ── POST /webhooks/menu-updated ────────────────────────────────────────

  describe('POST /webhooks/menu-updated', () => {
    it('returns 200 with success when record.vendor_id is present', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/menu-updated',
        payload: {
          type: 'INSERT',
          record: { id: 'menu-item-1', vendor_id: 'vendor-abc' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.vendorId).toBe('vendor-abc');
      expect(invalidateCacheMock).toHaveBeenCalledWith('vendor-abc');
    });

    it('uses old_record.vendor_id for DELETE events', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/menu-updated',
        payload: {
          type: 'DELETE',
          old_record: { id: 'menu-item-2', vendor_id: 'vendor-del' },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().vendorId).toBe('vendor-del');
      expect(invalidateCacheMock).toHaveBeenCalledWith('vendor-del');
    });

    it('returns 400 when vendor_id is missing from both record and old_record', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/menu-updated',
        payload: { type: 'UPDATE', record: { id: 'item-no-vendor' } },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().success).toBe(false);
      expect(res.json().error).toContain('Missing vendor_id');
    });

    it('returns 500 when invalidateCache throws', async () => {
      invalidateCacheMock.mockRejectedValue(new Error('Cache error'));

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/menu-updated',
        payload: {
          type: 'UPDATE',
          record: { id: 'item-1', vendor_id: 'vendor-err' },
        },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().success).toBe(false);
    });
  });

  // ── POST /webhooks/invalidate-cache ────────────────────────────────────

  describe('POST /webhooks/invalidate-cache', () => {
    it('invalidates a specific vendor cache when vendorId is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/invalidate-cache',
        payload: { vendorId: 'vendor-manual' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.message).toContain('vendor-manual');
      expect(invalidateCacheMock).toHaveBeenCalledWith('vendor-manual');
    });

    it('invalidates all caches when vendorId is not provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/invalidate-cache',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.message).toContain('All vendor caches');
      expect(invalidateCacheMock).toHaveBeenCalledWith(undefined);
    });

    it('returns 500 when invalidateCache throws', async () => {
      invalidateCacheMock.mockRejectedValue(new Error('Oops'));

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/invalidate-cache',
        payload: { vendorId: 'vendor-err' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().success).toBe(false);
      expect(res.json().error).toContain('Failed to invalidate cache');
    });
  });

  // ── GET /webhooks/health ───────────────────────────────────────────────

  describe('GET /webhooks/health', () => {
    it('returns 200 with status ok', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/webhooks/health',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('webhooks');
      expect(body.timestamp).toBeDefined();
    });
  });
});
