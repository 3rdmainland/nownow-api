import type { SmsProvider } from './sms.provider.js';

/**
 * BulkSMS.com SMS provider for OTP delivery.
 * Uses the JSON REST API v1.
 * https://www.bulksms.com/developer/json/v1/
 *
 * Environment variables:
 *   BULKSMS_TOKEN_ID     — API token ID from BulkSMS dashboard
 *   BULKSMS_TOKEN_SECRET — API token secret
 */
export class BulkSmsProvider implements SmsProvider {
    private readonly tokenId: string;
    private readonly tokenSecret: string;

    constructor() {
        const tokenId = process.env.BULKSMS_TOKEN_ID;
        const tokenSecret = process.env.BULKSMS_TOKEN_SECRET;

        if (!tokenId || !tokenSecret) {
            throw new Error('Missing BULKSMS_TOKEN_ID or BULKSMS_TOKEN_SECRET environment variables');
        }

        this.tokenId = tokenId;
        this.tokenSecret = tokenSecret;
    }

    async sendOtp(phone: string, code: string): Promise<void> {
        const message = `Your verification code is: ${code}. Valid for 5 minutes. Do not share this code.`;
        const to = phone.startsWith('+') ? phone : `+${phone}`;

        const payload = {
            to,
            body: message,
        };

        console.log(`[BulkSMS] Sending to ${to}`);

        try {
            const response = await fetch('https://api.bulksms.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + btoa(this.tokenId + ':' + this.tokenSecret),
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[BulkSMS] HTTP ${response.status} sending to ${to}: ${errorText}`);
                throw new Error(`BulkSMS returned ${response.status}`);
            }

            const result = await response.json() as any;
            // Response is single object when sending single message, array when sending batch
            const msg = Array.isArray(result) ? result[0] : result;

            console.log(`[BulkSMS] Response: ${JSON.stringify(msg?.status)} | from: ${msg?.from}`);

            if (msg?.status?.type === 'ACCEPTED' || msg?.status?.type === 'SENT') {
                console.log(`[BulkSMS] OTP accepted for ${to} | id: ${msg.id}`);
            } else {
                console.error(`[BulkSMS] Unexpected: ${JSON.stringify(msg)}`);
            }
        } catch (error: any) {
            console.error(`[BulkSMS] Error sending OTP to ${to}:`, error?.message || error);
            throw new Error('Failed to send verification code. Please try again.');
        }
    }
}
