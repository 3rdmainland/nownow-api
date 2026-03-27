import {
  StitchExpressTokenResponse,
  StitchPaymentLinkResponse,
  StitchPaymentStatusResponse,
  CreatePaymentResult,
} from './payment.types.js';
import { ServiceUnavailableError, InternalError } from '../lib/errors.js';

export class PaymentService {
  private clientToken: string | null = null;
  private tokenExpiresAt: number = 0;

  /**
   * Get a client token from Stitch Express token endpoint.
   * Tokens are cached until 1 minute before expiry.
   */
  async getClientToken(): Promise<string> {
    if (this.clientToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.clientToken;
    }

    const clientId = process.env.STITCH_CLIENT_ID;
    const clientSecret = process.env.STITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new InternalError('Stitch credentials not configured');
    }

    const res = await fetch('https://express.stitch.money/api/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({
        clientId,
        clientSecret,
        scope: 'client_paymentrequest',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ServiceUnavailableError(`Stitch token request failed: ${res.status} ${text}`);
    }

    const body = await res.json() as StitchExpressTokenResponse;
    const accessToken = body.data.accessToken;
    this.clientToken = accessToken;
    // Express tokens last 15 minutes; cache conservatively
    this.tokenExpiresAt = Date.now() + 14 * 60 * 1000;

    return accessToken;
  }

  /**
   * Create a payment link via Stitch Express REST API.
   * Returns the payment ID and payment link URL.
   */
  async createPaymentRequest(
    orderId: string,
    amountInCents: number,
    payerName: string,
    payerPhone?: string
  ): Promise<CreatePaymentResult> {
    const token = await this.getClientToken();

    const payload: Record<string, unknown> = {
      amount: amountInCents,
      merchantReference: orderId.slice(0, 50),
      payerName: payerName.slice(0, 40),
    };
    if (payerPhone) payload.payerPhoneNumber = payerPhone;

    const res = await fetch('https://express.stitch.money/api/v1/payment-links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ServiceUnavailableError(`Stitch payment link failed: ${res.status} ${text}`);
    }

    const body = await res.json() as StitchPaymentLinkResponse;

    if (!body.success || !body.data?.payment) {
      throw new InternalError('Stitch returned no payment data');
    }

    const payment = body.data.payment;

    // Append redirect URL so Stitch redirects back to our app after payment
    const redirectBase = process.env.STITCH_REDIRECT_BASE_URL || 'http://localhost:3000';
    const redirectUrl = `${redirectBase}/checkout/payment-callback`;
    const paymentUrl = `${payment.link}?redirect_uri=${encodeURIComponent(redirectUrl)}`;

    return {
      paymentId: payment.id,
      paymentUrl,
    };
  }

  /**
   * Poll Stitch Express for the current status of a payment link.
   */
  async checkPaymentStatus(paymentId: string): Promise<string> {
    const token = await this.getClientToken();

    const res = await fetch(`https://express.stitch.money/api/v1/payment-links/${paymentId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'accept': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ServiceUnavailableError(`Stitch status check failed: ${res.status} ${text}`);
    }

    const body = await res.json() as StitchPaymentStatusResponse;
    return body.data.payment.status;
  }

  /**
   * Verify Stitch webhook signature using HMAC-SHA256.
   */
  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    const secret = process.env.STITCH_WEBHOOK_SECRET;
    if (!secret) {
      throw new InternalError('Stitch webhook secret not configured');
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const computed = Buffer.from(sig).toString('hex');

    return computed === signature;
  }
}
