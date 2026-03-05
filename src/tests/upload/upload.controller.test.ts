import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { supabaseMock } from '../mocks/supabase.js';
import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';
import { buildApp, generateToken } from '../helpers/app.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock }));
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }));

vi.mock('../../lib/redis', () => ({
  default: redisMock,
  cache: cacheMock,
  CACHE_TTL: CACHE_TTL_MOCK,
}));

vi.mock('../../lib/redis.js', () => ({
  default: redisMock,
  cache: cacheMock,
  CACHE_TTL: CACHE_TTL_MOCK,
}));

// Import after mocks
import uploadController from '../../upload/upload.controller.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A tiny 1×1 white JPEG encoded as base64 */
const VALID_BASE64_IMAGE = Buffer.from('fake-image-data').toString('base64');

function createStorageMock(overrides: {
  listData?: any[];
  uploadError?: any;
  publicUrl?: string;
} = {}) {
  return {
    list: vi.fn().mockResolvedValue({ data: overrides.listData ?? [], error: null }),
    remove: vi.fn().mockResolvedValue({ data: null, error: null }),
    upload: vi.fn().mockResolvedValue({
      data: { path: 'test/path.jpg' },
      error: overrides.uploadError ?? null,
    }),
    getPublicUrl: vi.fn().mockReturnValue({
      data: { publicUrl: overrides.publicUrl ?? 'https://storage.test/uploaded.jpg' },
    }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Upload Controller (integration)', () => {
  let app: FastifyInstance;
  let storageBucketMock: ReturnType<typeof createStorageMock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    storageBucketMock = createStorageMock();
    supabaseMock.storage.from.mockReturnValue(storageBucketMock);

    app = await buildApp(async (fastify) => {
      await fastify.register(uploadController, { prefix: '/upload' });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /upload/event/:eventId ─────────────────────────────────────────────

  describe('POST /upload/event/:eventId', () => {
    it('returns 200 with upload result on success', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/upload/event/ev-123?purpose=event-banner',
        payload: { file: VALID_BASE64_IMAGE, mimetype: 'image/jpeg' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('url');
      expect(body).toHaveProperty('purpose', 'event-banner');
      expect(body).toHaveProperty('fileName');
    });

    it('returns 400 when file is missing from the body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/upload/event/ev-123?purpose=event-banner',
        payload: { mimetype: 'image/jpeg' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty('error');
    });

    it('returns 400 when file is empty string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/upload/event/ev-123?purpose=event-banner',
        payload: { file: '', mimetype: 'image/jpeg' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty('error');
    });

    it('returns 500 when upload to storage fails', async () => {
      storageBucketMock.upload.mockResolvedValue({
        data: null,
        error: { message: 'storage unavailable' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/upload/event/ev-123?purpose=event-banner',
        payload: { file: VALID_BASE64_IMAGE, mimetype: 'image/jpeg' },
      });

      expect(res.statusCode).toBe(500);
    });

    it('accepts all event-related purposes', async () => {
      const eventPurposes = ['landing-bg', 'app-bg', 'event-banner', 'logo-light', 'logo-dark', 'favicon'];

      for (const purpose of eventPurposes) {
        vi.clearAllMocks();
        storageBucketMock = createStorageMock();
        supabaseMock.storage.from.mockReturnValue(storageBucketMock);

        const res = await app.inject({
          method: 'POST',
          url: `/upload/event/ev-123?purpose=${purpose}`,
          payload: { file: VALID_BASE64_IMAGE, mimetype: 'image/jpeg' },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().purpose).toBe(purpose);
      }
    });

    it('does not require authentication', async () => {
      // No auth token — should still succeed
      const res = await app.inject({
        method: 'POST',
        url: '/upload/event/ev-123?purpose=event-banner',
        payload: { file: VALID_BASE64_IMAGE, mimetype: 'image/jpeg' },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── POST /upload/vendor/:vendorId ───────────────────────────────────────────

  describe('POST /upload/vendor/:vendorId', () => {
    it('returns 200 with upload result when authenticated', async () => {
      const token = generateToken(app, {
        userId: 'user-1',
        vendorId: 'vendor-456',
        email: 'vendor@test.com',
        role: 'vendor',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/upload/vendor/vendor-456?purpose=vendor-logo',
        headers: { authorization: `Bearer ${token}` },
        payload: { file: VALID_BASE64_IMAGE, mimetype: 'image/png' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('url');
      expect(body.purpose).toBe('vendor-logo');
    });

    it('returns 401 when no auth token is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/upload/vendor/vendor-456?purpose=vendor-logo',
        payload: { file: VALID_BASE64_IMAGE, mimetype: 'image/png' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when file is missing from the body', async () => {
      const token = generateToken(app, {
        userId: 'user-1',
        vendorId: 'vendor-456',
        email: 'vendor@test.com',
        role: 'vendor',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/upload/vendor/vendor-456?purpose=vendor-logo',
        headers: { authorization: `Bearer ${token}` },
        payload: { mimetype: 'image/png' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty('error');
    });

    it('returns 500 when upload to storage fails', async () => {
      storageBucketMock.upload.mockResolvedValue({
        data: null,
        error: { message: 'bucket not found' },
      });

      const token = generateToken(app, {
        userId: 'user-1',
        vendorId: 'vendor-456',
        email: 'vendor@test.com',
        role: 'vendor',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/upload/vendor/vendor-456?purpose=vendor-logo',
        headers: { authorization: `Bearer ${token}` },
        payload: { file: VALID_BASE64_IMAGE, mimetype: 'image/jpeg' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /upload/menu/:vendorId ─────────────────────────────────────────────

  describe('POST /upload/menu/:vendorId', () => {
    it('returns 200 with upload result when authenticated', async () => {
      const token = generateToken(app, {
        userId: 'user-1',
        vendorId: 'vendor-789',
        email: 'vendor@test.com',
        role: 'vendor',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/upload/menu/vendor-789?purpose=menu-item',
        headers: { authorization: `Bearer ${token}` },
        payload: { file: VALID_BASE64_IMAGE, mimetype: 'image/webp' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('url');
      expect(body.purpose).toBe('menu-item');
    });

    it('returns 401 when no auth token is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/upload/menu/vendor-789?purpose=menu-item',
        payload: { file: VALID_BASE64_IMAGE, mimetype: 'image/webp' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when file is missing from the body', async () => {
      const token = generateToken(app, {
        userId: 'user-1',
        vendorId: 'vendor-789',
        email: 'vendor@test.com',
        role: 'vendor',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/upload/menu/vendor-789?purpose=menu-item',
        headers: { authorization: `Bearer ${token}` },
        payload: { mimetype: 'image/webp' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty('error');
    });

    it('returns 500 when upload to storage fails', async () => {
      storageBucketMock.upload.mockResolvedValue({
        data: null,
        error: { message: 'permission denied' },
      });

      const token = generateToken(app, {
        userId: 'user-1',
        vendorId: 'vendor-789',
        email: 'vendor@test.com',
        role: 'vendor',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/upload/menu/vendor-789?purpose=menu-item',
        headers: { authorization: `Bearer ${token}` },
        payload: { file: VALID_BASE64_IMAGE, mimetype: 'image/jpeg' },
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
