import { createRequire } from 'module';
import type { SmsProvider } from './sms.provider.js';

const require = createRequire(import.meta.url);

/**
 * Africa's Talking SMS provider for OTP delivery.
 *
 * Environment variables:
 *   AT_API_KEY      — API key from Africa's Talking dashboard
 *   AT_USERNAME     — App username (use 'sandbox' for testing)
 *   AT_SENDER_ID   — Optional registered sender ID / shortcode
 */
export class AfricasTalkingSmsProvider implements SmsProvider {
    private sms: any;
    private senderId: string | undefined;

    constructor() {
        const apiKey = process.env.AT_API_KEY;
        const username = process.env.AT_USERNAME;

        if (!apiKey || !username) {
            throw new Error('Missing AT_API_KEY or AT_USERNAME environment variables for Africa\'s Talking SMS');
        }

        const AfricasTalking = require('africastalking');
        const client = AfricasTalking({ apiKey, username });
        this.sms = client.SMS;
        this.senderId = process.env.AT_SENDER_ID || undefined;
    }

    async sendOtp(phone: string, code: string): Promise<void> {
        const message = `Your NowNow verification code is: ${code}. Valid for 5 minutes. Do not share this code.`;

        // Ensure phone is in international format (+27...)
        const to = phone.startsWith('+') ? phone : `+${phone}`;

        try {
            const result = await this.sms.send({
                to: [to],
                message,
                ...(this.senderId ? { from: this.senderId } : {}),
            });

            // Log for observability (strip the actual code)
            const recipient = result?.SMSMessageData?.Recipients?.[0];
            if (recipient?.status === 'Success') {
                console.log(`[AT-SMS] OTP sent to ${to} | messageId: ${recipient.messageId} | cost: ${recipient.cost}`);
            } else {
                const statusCode = recipient?.statusCode;
                const status = recipient?.status || 'Unknown';
                console.error(`[AT-SMS] Failed to send to ${to} | status: ${status} | statusCode: ${statusCode}`);
                // Don't throw — OTP is still generated, customer can retry
            }
        } catch (error: any) {
            console.error(`[AT-SMS] Error sending OTP to ${to}:`, error?.message || error);
            // Rethrow so the controller knows delivery failed
            throw new Error('Failed to send verification code. Please try again.');
        }
    }
}
