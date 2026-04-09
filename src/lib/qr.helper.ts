import QRCode from 'qrcode';
import { createHmac } from 'crypto';
import { supabase } from './supabase';

export interface QRCodeResult {
    qr_code: string;
    qr_image: string;
}

export interface QRVerifyResult {
    valid: boolean;
    orderId: string | null;
    isLegacy: boolean;
}

export class QRHelper {
    private bucketName = 'order-qrcodes';

    /**
     * HMAC-SHA256 sign an arbitrary payload, truncated to 16 hex chars
     */
    private signPayload(payload: string): string {
        const secret = process.env.QR_SIGN_SECRET || process.env.JWT_SECRET || 'default-dev-secret';
        return createHmac('sha256', secret)
            .update(payload)
            .digest('hex')
            .slice(0, 16);
    }

    /**
     * HMAC-SHA256 sign an order ID, truncated to 16 hex chars
     */
    signOrderId(orderId: string): string {
        return this.signPayload(orderId);
    }

    /**
     * Generates a signed QR code string: ORDER:{orderId}:{signature}
     */
    generateQRCodeString(orderId: string): string {
        const signature = this.signOrderId(orderId);
        return `ORDER:${orderId}:${signature}`;
    }

    /**
     * Verifies a QR code signature. Supports both signed (3-part) and legacy unsigned (2-part) formats.
     */
    verifyQRSignature(qrCode: string): QRVerifyResult {
        if (!qrCode.startsWith('ORDER:')) {
            return { valid: false, orderId: null, isLegacy: false };
        }

        const parts = qrCode.split(':');

        // Legacy format: ORDER:{orderId}
        if (parts.length === 2) {
            return { valid: true, orderId: parts[1], isLegacy: true };
        }

        // Signed format: ORDER:{orderId}:{signature}
        if (parts.length === 3) {
            const orderId = parts[1];
            const signature = parts[2];
            const expectedSignature = this.signOrderId(orderId);
            const valid = signature === expectedSignature;
            return { valid, orderId: valid ? orderId : null, isLegacy: false };
        }

        return { valid: false, orderId: null, isLegacy: false };
    }

    /**
     * Parses QR code string to extract order ID (backward-compatible)
     */
    parseQRCode(qrCode: string): string | null {
        const result = this.verifyQRSignature(qrCode);
        return result.valid ? result.orderId : null;
    }

    /**
     * Generates a QR code image as a buffer
     */
    async generateQRCodeBuffer(data: string): Promise<Buffer> {
        return QRCode.toBuffer(data, {
            type: 'png',
            width: 400,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF',
            },
            errorCorrectionLevel: 'M',
        });
    }

    /**
     * Uploads QR code image to Supabase Storage and returns the public URL
     */
    async uploadQRCodeImage(buffer: Buffer, orderId: string): Promise<string> {
        const fileName = `qr-${orderId}-${Date.now()}.png`;
        const filePath = `orders/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from(this.bucketName)
            .upload(filePath, buffer, {
                contentType: 'image/png',
                upsert: true,
            });

        if (uploadError) {
            throw new Error(`Failed to upload QR code image: ${uploadError.message}`);
        }

        const { data: urlData } = supabase.storage
            .from(this.bucketName)
            .getPublicUrl(filePath);

        return urlData.publicUrl;
    }

    /**
     * Generates QR code string, creates image, uploads to storage, and returns both
     */
    async generateAndUploadQRCode(orderId: string): Promise<QRCodeResult> {
        const qrCode = this.generateQRCodeString(orderId);
        const qrBuffer = await this.generateQRCodeBuffer(qrCode);
        const qrImageUrl = await this.uploadQRCodeImage(qrBuffer, orderId);

        return {
            qr_code: qrCode,
            qr_image: qrImageUrl,
        };
    }

    /**
     * Generates a signed QR code string for a vendor at a specific event:
     * VENDOR_EVENT:{eventId}:{vendorId}:{signature}
     */
    generateVendorEventQR(eventId: string, vendorId: string): string {
        const payload = `VENDOR_EVENT:${eventId}:${vendorId}`;
        const signature = this.signPayload(payload);
        return `${payload}:${signature}`;
    }

    /**
     * Generates a signed QR code string for a vendor (not event-specific):
     * VENDOR_DIRECT:{vendorId}:{signature}
     */
    generateVendorDirectQR(vendorId: string): string {
        const payload = `VENDOR_DIRECT:${vendorId}`;
        const signature = this.signPayload(payload);
        return `${payload}:${signature}`;
    }

    /**
     * Verifies a vendor-event QR code signature
     */
    verifyVendorEventQR(qrCode: string): { valid: boolean; eventId: string | null; vendorId: string | null } {
        if (!qrCode.startsWith('VENDOR_EVENT:')) {
            return { valid: false, eventId: null, vendorId: null };
        }
        const parts = qrCode.split(':');
        if (parts.length !== 4) {
            return { valid: false, eventId: null, vendorId: null };
        }
        const [, eventId, vendorId, signature] = parts;
        const expectedPayload = `VENDOR_EVENT:${eventId}:${vendorId}`;
        const expectedSig = this.signPayload(expectedPayload);
        const valid = signature === expectedSig;
        return { valid, eventId: valid ? eventId : null, vendorId: valid ? vendorId : null };
    }

    /**
     * Verifies a vendor-direct QR code signature
     */
    verifyVendorDirectQR(qrCode: string): { valid: boolean; vendorId: string | null } {
        if (!qrCode.startsWith('VENDOR_DIRECT:')) {
            return { valid: false, vendorId: null };
        }
        const parts = qrCode.split(':');
        if (parts.length !== 3) {
            return { valid: false, vendorId: null };
        }
        const [, vendorId, signature] = parts;
        const expectedPayload = `VENDOR_DIRECT:${vendorId}`;
        const expectedSig = this.signPayload(expectedPayload);
        const valid = signature === expectedSig;
        return { valid, vendorId: valid ? vendorId : null };
    }

    /**
     * Uploads a vendor-event QR code image to Supabase Storage and returns the public URL
     */
    async uploadVendorEventQRImage(buffer: Buffer, identifier: string): Promise<string> {
        const fileName = `vendor-event-qr-${identifier}-${Date.now()}.png`;
        const filePath = `vendor-events/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from(this.bucketName)
            .upload(filePath, buffer, {
                contentType: 'image/png',
                upsert: true,
            });

        if (uploadError) {
            throw new Error(`Failed to upload vendor event QR image: ${uploadError.message}`);
        }

        const { data: urlData } = supabase.storage
            .from(this.bucketName)
            .getPublicUrl(filePath);

        return urlData.publicUrl;
    }
}
