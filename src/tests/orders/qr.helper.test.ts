import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase before importing QRHelper (it imports supabase transitively)
vi.mock('../../lib/supabase.js', () => ({
    supabase: {
        storage: {
            from: vi.fn().mockReturnValue({
                upload: vi.fn().mockResolvedValue({ error: null }),
                getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://test.com/qr.png' } }),
            }),
        },
    },
}));

import { QRHelper } from '../../lib/qr.helper.js';

describe('QRHelper', () => {
    let qr: QRHelper;

    beforeEach(() => {
        qr = new QRHelper();
    });

    describe('signOrderId', () => {
        it('produces a 16-char hex string', () => {
            const sig = qr.signOrderId('test-order-123');
            expect(sig).toMatch(/^[a-f0-9]{16}$/);
        });

        it('is deterministic for the same input', () => {
            const sig1 = qr.signOrderId('order-abc');
            const sig2 = qr.signOrderId('order-abc');
            expect(sig1).toBe(sig2);
        });

        it('produces different signatures for different order IDs', () => {
            const sig1 = qr.signOrderId('order-1');
            const sig2 = qr.signOrderId('order-2');
            expect(sig1).not.toBe(sig2);
        });
    });

    describe('generateQRCodeString', () => {
        it('returns ORDER:{id}:{signature} format', () => {
            const qrString = qr.generateQRCodeString('my-order-id');
            const parts = qrString.split(':');
            expect(parts).toHaveLength(3);
            expect(parts[0]).toBe('ORDER');
            expect(parts[1]).toBe('my-order-id');
            expect(parts[2]).toMatch(/^[a-f0-9]{16}$/);
        });
    });

    describe('verifyQRSignature', () => {
        it('verifies a correctly signed QR code', () => {
            const qrString = qr.generateQRCodeString('order-valid');
            const result = qr.verifyQRSignature(qrString);
            expect(result.valid).toBe(true);
            expect(result.orderId).toBe('order-valid');
            expect(result.isLegacy).toBe(false);
        });

        it('rejects a forged signature', () => {
            const result = qr.verifyQRSignature('ORDER:order-1:0000000000000000');
            expect(result.valid).toBe(false);
            expect(result.orderId).toBeNull();
        });

        it('accepts legacy unsigned format (backward compat)', () => {
            const result = qr.verifyQRSignature('ORDER:legacy-order-id');
            expect(result.valid).toBe(true);
            expect(result.orderId).toBe('legacy-order-id');
            expect(result.isLegacy).toBe(true);
        });

        it('rejects codes that do not start with ORDER:', () => {
            const result = qr.verifyQRSignature('INVALID:something');
            expect(result.valid).toBe(false);
            expect(result.orderId).toBeNull();
        });

        it('rejects empty strings', () => {
            const result = qr.verifyQRSignature('');
            expect(result.valid).toBe(false);
        });

        it('rejects codes with too many parts', () => {
            const result = qr.verifyQRSignature('ORDER:id:sig:extra');
            expect(result.valid).toBe(false);
        });
    });

    describe('parseQRCode (backward compat)', () => {
        it('parses signed QR codes', () => {
            const qrString = qr.generateQRCodeString('test-id');
            expect(qr.parseQRCode(qrString)).toBe('test-id');
        });

        it('parses legacy QR codes', () => {
            expect(qr.parseQRCode('ORDER:legacy-id')).toBe('legacy-id');
        });

        it('returns null for invalid codes', () => {
            expect(qr.parseQRCode('BAD-CODE')).toBeNull();
        });

        it('returns null for forged signatures', () => {
            expect(qr.parseQRCode('ORDER:id:forgedforgedforge')).toBeNull();
        });
    });

    describe('different secrets produce different signatures', () => {
        it('uses QR_SIGN_SECRET env var when available', () => {
            const originalSecret = process.env.QR_SIGN_SECRET;
            const orderId = 'secret-test-order';

            process.env.QR_SIGN_SECRET = 'secret-A';
            const qr1 = new QRHelper();
            const sig1 = qr1.signOrderId(orderId);

            process.env.QR_SIGN_SECRET = 'secret-B';
            const qr2 = new QRHelper();
            const sig2 = qr2.signOrderId(orderId);

            expect(sig1).not.toBe(sig2);

            // Restore
            if (originalSecret !== undefined) {
                process.env.QR_SIGN_SECRET = originalSecret;
            } else {
                delete process.env.QR_SIGN_SECRET;
            }
        });
    });
});
