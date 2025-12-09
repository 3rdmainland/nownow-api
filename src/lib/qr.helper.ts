import QRCode from 'qrcode';
import { supabase } from '../../supabase';

export interface QRCodeResult {
    qr_code: string;
    qr_image: string;
}

export class QRHelper {
    private bucketName = 'order-qrcodes';

    /**
     * Generates a unique QR code string containing the order ID
     * This will be scanned to confirm collection
     */
    generateQRCodeString(orderId: string): string {
        return `ORDER:${orderId}`;
    }

    /**
     * Parses QR code string to extract order ID
     */
    parseQRCode(qrCode: string): string | null {
        if (qrCode.startsWith('ORDER:')) {
            return qrCode.replace('ORDER:', '');
        }
        return null;
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
