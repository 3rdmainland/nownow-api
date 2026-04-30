/**
 * SMS fallback for order status notifications when WhatsApp is disabled.
 * Uses BulkSMS API (same provider as OTP).
 */

const BULKSMS_API = 'https://api.bulksms.com/v1/messages';
const CUSTOMER_APP_URL = process.env.CUSTOMER_APP_URL || 'https://nownow-nine.vercel.app';

async function sendSms(to: string, body: string): Promise<void> {
    const tokenId = process.env.BULKSMS_TOKEN_ID;
    const tokenSecret = process.env.BULKSMS_TOKEN_SECRET;

    if (!tokenId || !tokenSecret) {
        console.warn('[OrderSMS] Missing BulkSMS credentials, skipping SMS');
        return;
    }

    const phone = to.startsWith('+') ? to : `+${to}`;

    const response = await fetch(BULKSMS_API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + btoa(tokenId + ':' + tokenSecret),
        },
        body: JSON.stringify({ to: phone, body }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OrderSMS] HTTP ${response.status}: ${errorText}`);
    }
}

export async function sendOrderReadySms(
    phone: string,
    params: { orderId: string; vendorName: string; total?: number; paymentMethod?: string },
): Promise<void> {
    const orderRef = params.orderId.slice(-4).toUpperCase();
    const qrLink = `${CUSTOMER_APP_URL}/orders`;
    let message = `Hey! Your order #${orderRef} from ${params.vendorName} is READY and waiting for you!`;
    if (params.paymentMethod === 'CASH' && params.total != null) {
        message += ` Have R${Number(params.total).toFixed(2)} ready to pay at the stall.`;
    }
    message += ` Show your QR code to collect: ${qrLink}`;
    await sendSms(phone, message);
}

export async function sendPickupReminderSms(
    phone: string,
    params: { orderId: string; vendorName: string },
): Promise<void> {
    const orderRef = params.orderId.slice(-4).toUpperCase();
    const message = `Order Reminder - your order #${orderRef} from ${params.vendorName} is still waiting for pickup. Please collect it soon!`;
    await sendSms(phone, message);
}
