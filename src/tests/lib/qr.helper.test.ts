import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock } from '../mocks/supabase.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

const { mockToBuffer } = vi.hoisted(() => ({
  mockToBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-png-data')),
}));

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));

vi.mock('qrcode', () => ({
  default: {
    toBuffer: mockToBuffer,
  },
}));

// Import after mocks
import { QRHelper } from '../../lib/qr.helper.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('QRHelper', () => {
  let helper: QRHelper;

  beforeEach(() => {
    vi.clearAllMocks();
    helper = new QRHelper();
  });

  // ── generateQRCodeString ────────────────────────────────────────────────────

  describe('generateQRCodeString', () => {
    it('should return a string prefixed with ORDER:', () => {
      const result = helper.generateQRCodeString('order-123');

      expect(result).toBe('ORDER:order-123');
    });

    it('should work with UUID order IDs', () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const result = helper.generateQRCodeString(uuid);

      expect(result).toBe(`ORDER:${uuid}`);
    });

    it('should handle empty string order ID', () => {
      const result = helper.generateQRCodeString('');

      expect(result).toBe('ORDER:');
    });
  });

  // ── parseQRCode ────────────────────────────────────────────────────────────

  describe('parseQRCode', () => {
    it('should extract the order ID from a valid ORDER: prefixed QR code', () => {
      const result = helper.parseQRCode('ORDER:order-123');

      expect(result).toBe('order-123');
    });

    it('should return null for a QR code without the ORDER: prefix', () => {
      const result = helper.parseQRCode('INVALID:order-123');

      expect(result).toBeNull();
    });

    it('should return null for an empty string', () => {
      const result = helper.parseQRCode('');

      expect(result).toBeNull();
    });

    it('should return null for a QR code with similar but incorrect prefix', () => {
      const result = helper.parseQRCode('order:order-123'); // lowercase

      expect(result).toBeNull();
    });

    it('should handle ORDER: prefix with empty order ID', () => {
      const result = helper.parseQRCode('ORDER:');

      expect(result).toBe('');
    });

    it('should handle QR codes with special characters in the order ID', () => {
      const result = helper.parseQRCode('ORDER:abc-123_def.456');

      expect(result).toBe('abc-123_def.456');
    });

    it('should be the inverse of generateQRCodeString', () => {
      const orderId = 'test-order-uuid';
      const qrString = helper.generateQRCodeString(orderId);
      const parsed = helper.parseQRCode(qrString);

      expect(parsed).toBe(orderId);
    });
  });

  // ── generateQRCodeBuffer ──────────────────────────────────────────────────

  describe('generateQRCodeBuffer', () => {
    it('should call QRCode.toBuffer with correct parameters', async () => {
      await helper.generateQRCodeBuffer('ORDER:test-123');

      expect(mockToBuffer).toHaveBeenCalledWith(
        'ORDER:test-123',
        expect.objectContaining({
          type: 'png',
          width: 400,
          margin: 2,
          errorCorrectionLevel: 'M',
        }),
      );
    });

    it('should return a Buffer', async () => {
      const result = await helper.generateQRCodeBuffer('ORDER:test');

      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('should propagate errors from QRCode.toBuffer', async () => {
      mockToBuffer.mockRejectedValueOnce(new Error('QR generation failed'));

      await expect(helper.generateQRCodeBuffer('bad-data')).rejects.toThrow('QR generation failed');
    });
  });

  // ── uploadQRCodeImage ───────────────────────────────────────────────────────

  describe('uploadQRCodeImage', () => {
    it('should upload buffer to Supabase storage and return the public URL', async () => {
      const buffer = Buffer.from('fake-png');

      const result = await helper.uploadQRCodeImage(buffer, 'order-789');

      expect(result).toBe('https://storage.test/path.png');
      expect(supabaseMock.storage.from).toHaveBeenCalledWith('order-qrcodes');
    });

    it('should throw when upload fails', async () => {
      const buffer = Buffer.from('fake-png');

      supabaseMock.storage.from.mockReturnValueOnce({
        upload: vi.fn().mockResolvedValue({ data: null, error: { message: 'Bucket not found' } }),
        getPublicUrl: vi.fn(),
      });

      await expect(helper.uploadQRCodeImage(buffer, 'order-789')).rejects.toThrow(
        'Failed to upload QR code image: Bucket not found',
      );
    });
  });

  // ── generateAndUploadQRCode ────────────────────────────────────────────────

  describe('generateAndUploadQRCode', () => {
    it('should generate QR code string, create image, upload, and return both', async () => {
      const result = await helper.generateAndUploadQRCode('order-abc');

      expect(result).toEqual({
        qr_code: 'ORDER:order-abc',
        qr_image: 'https://storage.test/path.png',
      });
    });

    it('should call toBuffer with the generated QR string', async () => {
      await helper.generateAndUploadQRCode('order-xyz');

      expect(mockToBuffer).toHaveBeenCalledWith(
        'ORDER:order-xyz',
        expect.any(Object),
      );
    });
  });
});
