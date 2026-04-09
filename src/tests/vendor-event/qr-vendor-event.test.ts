import { describe, it, expect } from 'vitest';
import { QRHelper } from '../../lib/qr.helper.js';

describe('QRHelper – vendor event QR codes', () => {
  const qr = new QRHelper();

  describe('generateVendorEventQR', () => {
    it('returns string with VENDOR_EVENT prefix, eventId, vendorId, and 16-char signature', () => {
      const result = qr.generateVendorEventQR('event-123', 'vendor-456');
      const parts = result.split(':');
      expect(parts[0]).toBe('VENDOR_EVENT');
      expect(parts[1]).toBe('event-123');
      expect(parts[2]).toBe('vendor-456');
      expect(parts[3]).toHaveLength(16);
    });
  });

  describe('generateVendorDirectQR', () => {
    it('returns string with VENDOR_DIRECT prefix, vendorId, and 16-char signature', () => {
      const result = qr.generateVendorDirectQR('vendor-456');
      const parts = result.split(':');
      expect(parts[0]).toBe('VENDOR_DIRECT');
      expect(parts[1]).toBe('vendor-456');
      expect(parts[2]).toHaveLength(16);
    });
  });

  describe('verifyVendorEventQR', () => {
    it('returns valid=true with correct eventId and vendorId for a valid QR', () => {
      const qrCode = qr.generateVendorEventQR('event-123', 'vendor-456');
      const result = qr.verifyVendorEventQR(qrCode);
      expect(result).toEqual({ valid: true, eventId: 'event-123', vendorId: 'vendor-456' });
    });

    it('returns valid=false for tampered QR', () => {
      const result = qr.verifyVendorEventQR('VENDOR_EVENT:event-123:vendor-456:0000000000000000');
      expect(result.valid).toBe(false);
    });

    it('returns valid=false for wrong prefix', () => {
      const result = qr.verifyVendorEventQR('ORDER:event-123:vendor-456:abc');
      expect(result.valid).toBe(false);
    });
  });

  describe('verifyVendorDirectQR', () => {
    it('returns valid=true with correct vendorId for a valid QR', () => {
      const qrCode = qr.generateVendorDirectQR('vendor-456');
      const result = qr.verifyVendorDirectQR(qrCode);
      expect(result).toEqual({ valid: true, vendorId: 'vendor-456' });
    });

    it('returns valid=false for tampered QR', () => {
      const result = qr.verifyVendorDirectQR('VENDOR_DIRECT:vendor-456:0000000000000000');
      expect(result.valid).toBe(false);
    });
  });
});
