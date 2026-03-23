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
     * HMAC-SHA256 sign an order ID, truncated to 16 hex chars
     */
    signOrderId(orderId: string): string {
        const secret = process.env.QR_SIGN_SECRET || process.env.JWT_SECRET || 'default-dev-secret';
        return createHmac('sha256', secret)
            .update(orderId)
            .digest('hex')
            .slice(0, 16);
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
}
