import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock } from '../mocks/supabase.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));

// Import after mocks
import { uploadImage } from '../../upload/upload.service.js';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, BUCKET_MAP } from '../../upload/upload.types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createStorageMock(overrides: {
  listData?: any[];
  listError?: any;
  removeData?: any;
  removeError?: any;
  uploadData?: any;
  uploadError?: any;
  publicUrl?: string;
} = {}) {
  return {
    list: vi.fn().mockResolvedValue({
      data: overrides.listData ?? [],
      error: overrides.listError ?? null,
    }),
    remove: vi.fn().mockResolvedValue({
      data: overrides.removeData ?? null,
      error: overrides.removeError ?? null,
    }),
    upload: vi.fn().mockResolvedValue({
      data: overrides.uploadData ?? { path: 'test/path.jpg' },
      error: overrides.uploadError ?? null,
    }),
    getPublicUrl: vi.fn().mockReturnValue({
      data: { publicUrl: overrides.publicUrl ?? 'https://storage.test/uploaded.jpg' },
    }),
  };
}

function makeBuffer(sizeBytes: number = 1024): Buffer {
  return Buffer.alloc(sizeBytes, 'a');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('uploadImage', () => {
  let storageBucketMock: ReturnType<typeof createStorageMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    storageBucketMock = createStorageMock();
    supabaseMock.storage.from.mockReturnValue(storageBucketMock);
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  describe('validation', () => {
    it('throws ValidationError for an unsupported MIME type', async () => {
      const buffer = makeBuffer();

      await expect(
        uploadImage(buffer, 'image/gif', 'event-123', 'event-banner'),
      ).rejects.toThrow('Invalid file type: image/gif');
    });

    it('throws ValidationError for a non-image MIME type', async () => {
      const buffer = makeBuffer();

      await expect(
        uploadImage(buffer, 'application/pdf', 'event-123', 'event-banner'),
      ).rejects.toThrow('Invalid file type');
    });

    it('throws ValidationError when the file exceeds MAX_FILE_SIZE', async () => {
      const oversized = makeBuffer(MAX_FILE_SIZE + 1);

      await expect(
        uploadImage(oversized, 'image/jpeg', 'event-123', 'event-banner'),
      ).rejects.toThrow('File too large');
    });

    it('accepts all allowed MIME types', async () => {
      for (const mime of ALLOWED_MIME_TYPES) {
        const buffer = makeBuffer();
        const result = await uploadImage(buffer, mime, 'res-id', 'event-banner');
        expect(result).toHaveProperty('url');
      }
    });

    it('accepts a file exactly at MAX_FILE_SIZE', async () => {
      const exactSize = makeBuffer(MAX_FILE_SIZE);

      const result = await uploadImage(exactSize, 'image/jpeg', 'event-123', 'event-banner');

      expect(result).toHaveProperty('url');
    });
  });

  // ── Successful upload ───────────────────────────────────────────────────────

  describe('successful upload', () => {
    it('returns url, purpose, and fileName on success', async () => {
      const buffer = makeBuffer();

      const result = await uploadImage(buffer, 'image/jpeg', 'event-abc', 'event-banner');

      expect(result).toMatchObject({
        url: 'https://storage.test/uploaded.jpg',
        purpose: 'event-banner',
      });
      expect(result.fileName).toMatch(/^event-banner-\d+\.jpg$/);
    });

    it('uses the correct bucket and path prefix for event purposes', async () => {
      const buffer = makeBuffer();

      await uploadImage(buffer, 'image/jpeg', 'ev-123', 'landing-bg');

      expect(supabaseMock.storage.from).toHaveBeenCalledWith('event-branding');
      expect(storageBucketMock.upload).toHaveBeenCalledWith(
        expect.stringContaining('events/ev-123/'),
        buffer,
        expect.objectContaining({ contentType: 'image/jpeg' }),
      );
    });

    it('uses the correct bucket and path prefix for vendor-logo', async () => {
      const buffer = makeBuffer();

      await uploadImage(buffer, 'image/png', 'vendor-456', 'vendor-logo');

      expect(supabaseMock.storage.from).toHaveBeenCalledWith('vendor-images');
      expect(storageBucketMock.upload).toHaveBeenCalledWith(
        expect.stringContaining('vendors/vendor-456/'),
        buffer,
        expect.objectContaining({ contentType: 'image/png' }),
      );
    });

    it('uses the correct bucket and path prefix for menu-item', async () => {
      const buffer = makeBuffer();

      await uploadImage(buffer, 'image/webp', 'vendor-789', 'menu-item');

      expect(supabaseMock.storage.from).toHaveBeenCalledWith('menu-images');
      expect(storageBucketMock.upload).toHaveBeenCalledWith(
        expect.stringContaining('vendors/vendor-789/'),
        buffer,
        expect.objectContaining({ contentType: 'image/webp' }),
      );
    });

    it('generates the correct file extension for each MIME type', async () => {
      const buffer = makeBuffer();

      const jpegResult = await uploadImage(buffer, 'image/jpeg', 'id', 'event-banner');
      expect(jpegResult.fileName).toMatch(/\.jpg$/);

      const pngResult = await uploadImage(buffer, 'image/png', 'id', 'event-banner');
      expect(pngResult.fileName).toMatch(/\.png$/);

      const webpResult = await uploadImage(buffer, 'image/webp', 'id', 'event-banner');
      expect(webpResult.fileName).toMatch(/\.webp$/);
    });
  });

  // ── Stale file cleanup ──────────────────────────────────────────────────────

  describe('stale file cleanup', () => {
    it('deletes existing files matching the purpose prefix before uploading', async () => {
      storageBucketMock.list.mockResolvedValue({
        data: [
          { name: 'event-banner-111.jpg' },
          { name: 'event-banner-222.png' },
          { name: 'logo-light-333.jpg' }, // different purpose — should not be deleted
        ],
        error: null,
      });

      const buffer = makeBuffer();
      await uploadImage(buffer, 'image/jpeg', 'ev-id', 'event-banner');

      expect(storageBucketMock.remove).toHaveBeenCalledWith([
        'events/ev-id/event-banner-111.jpg',
        'events/ev-id/event-banner-222.png',
      ]);
    });

    it('skips deletion when no existing files match', async () => {
      storageBucketMock.list.mockResolvedValue({
        data: [{ name: 'other-file.jpg' }],
        error: null,
      });

      const buffer = makeBuffer();
      await uploadImage(buffer, 'image/jpeg', 'ev-id', 'event-banner');

      expect(storageBucketMock.remove).not.toHaveBeenCalled();
    });

    it('skips deletion when the folder is empty', async () => {
      storageBucketMock.list.mockResolvedValue({ data: [], error: null });

      const buffer = makeBuffer();
      await uploadImage(buffer, 'image/jpeg', 'ev-id', 'event-banner');

      expect(storageBucketMock.remove).not.toHaveBeenCalled();
    });
  });

  // ── Upload failure ──────────────────────────────────────────────────────────

  describe('upload failure', () => {
    it('throws an error when supabase upload fails', async () => {
      storageBucketMock.upload.mockResolvedValue({
        data: null,
        error: { message: 'storage quota exceeded' },
      });

      const buffer = makeBuffer();

      await expect(
        uploadImage(buffer, 'image/jpeg', 'ev-id', 'event-banner'),
      ).rejects.toThrow('Upload failed: storage quota exceeded');
    });
  });

  // ── BUCKET_MAP coverage ─────────────────────────────────────────────────────

  describe('BUCKET_MAP', () => {
    it('has an entry for every ImagePurpose', () => {
      const purposes = [
        'landing-bg', 'app-bg', 'event-banner',
        'logo-light', 'logo-dark', 'favicon',
        'vendor-logo', 'menu-item',
      ] as const;

      for (const p of purposes) {
        expect(BUCKET_MAP[p]).toBeDefined();
        expect(BUCKET_MAP[p].bucket).toBeTruthy();
        expect(typeof BUCKET_MAP[p].pathPrefix).toBe('function');
      }
    });

    it('generates correct path prefixes', () => {
      expect(BUCKET_MAP['event-banner'].pathPrefix('ev-1')).toBe('events/ev-1');
      expect(BUCKET_MAP['vendor-logo'].pathPrefix('v-1')).toBe('vendors/v-1');
      expect(BUCKET_MAP['menu-item'].pathPrefix('v-2')).toBe('vendors/v-2');
    });
  });
});
