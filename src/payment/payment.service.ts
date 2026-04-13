import type {
  StitchOAuthTokenResponse,
  StitchPaymentRequestBody,
  StitchPaymentResponse,
  CreatePaymentResult,
} from './payment.types.js';
import { ServiceUnavailableError, InternalError } from '../lib/errors.js';

const STITCH_TOKEN_URL = 'https://secure.stitch.money/connect/token';
const STITCH_API_URL = 'https://api.stitch.money/v2';

class PaymentService {
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  /**
   * Get a client token via OAuth 2.0 Client Credentials flow.
   * Cached until 80% of lifetime.
   */
  async getClientToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const clientId = process.env.STITCH_CLIENT_ID;
    const clientSecret = process.env.STITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new InternalError('Stitch credentials not configured');
    }

    const res = await fetch(STITCH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'client_paymentrequest',
        audience: STITCH_TOKEN_URL,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ServiceUnavailableError(`Stitch token request failed: ${res.status} ${text}`);
    }

    const body = await res.json() as StitchOAuthTokenResponse;
    this.accessToken = body.access_token;
    this.tokenExpiresAt = Date.now() + (body.expires_in * 0.8 * 1000);
    return this.accessToken;
  }

  /**
   * Create a payment request via Stitch REST v2.
   * Supports EFT (including Capitec Pay) + Cards.
   * Amount is in Rands (not cents).
   */
  async createPaymentRequest(
    orderId: string,
    amountInRands: number,
    payerName: string,
    payerPhone: string
  ): Promise<CreatePaymentResult> {
    const token = await this.getClientToken();
    const orderRef = orderId.slice(-8).toUpperCase();

    const payload: StitchPaymentRequestBody = {
      amount: { currency: 'ZAR', quantity: amountInRands },
      externalReference: orderId,
      expireAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      payer: {
        identifier: payerPhone,
        fullName: payerName.slice(0, 40),
        mobileNumber: payerPhone,
      },
      paymentMethods: {
        eft: {
          enabled: true,
          payerReference: `NowNow ${orderRef}`.slice(0, 12),
          beneficiaryReference: orderRef.slice(0, 20),
          beneficiary: {
            name: process.env.STITCH_BENEFICIARY_NAME || '',
            bank: process.env.STITCH_BENEFICIARY_BANK || '',
            accountNumber: process.env.STITCH_BENEFICIARY_ACCOUNT || '',
          },
          capitecPay: { enabled: true },
        },
        card: { enabled: true },
      },
    };

    const res = await fetch(`${STITCH_API_URL}/payment-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ServiceUnavailableError(`Stitch payment request failed: ${res.status} ${text}`);
    }

    const body = await res.json() as StitchPaymentResponse;

    const redirectUrl = process.env.STITCH_REDIRECT_URL;
    if (!redirectUrl) throw new InternalError('STITCH_REDIRECT_URL not configured — cannot redirect after payment');
    const paymentUrl = `${body.interaction.url}?redirect_uri=${encodeURIComponent(redirectUrl)}`;

    return {
      paymentId: body.id,
      paymentUrl,
    };
  }

  /**
   * Check payment status via Stitch REST v2.
   */
  async checkPaymentStatus(paymentId: string): Promise<string> {
    const token = await this.getClientToken();

    const res = await fetch(`${STITCH_API_URL}/payment-requests/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ServiceUnavailableError(`Stitch status check failed: ${res.status} ${text}`);
    }

    const body = await res.json() as StitchPaymentResponse;
    return body.status;
  }

  /**
   * Cancel a pending payment request via Stitch REST v2.
   */
  async cancelPaymentRequest(paymentId: string, reason: string): Promise<void> {
    const token = await this.getClientToken();

    const res = await fetch(`${STITCH_API_URL}/payment-requests/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id: paymentId, reason }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`Stitch cancel failed (non-fatal): ${res.status} ${text}`);
    }
  }

  /**
   * Verify webhook signature using X-Stitch-Signature header.
   * Format: t={unix_timestamp},hmac_sha256={hex_signature}
   * Signed content: "{timestamp}.{raw_body}" with HMAC-SHA256
   */
  async verifyWebhookSignature(payload: string, signatureHeader: string): Promise<boolean> {
    const secret = process.env.STITCH_WEBHOOK_SECRET;
    if (!secret) throw new InternalError('Stitch webhook secret not configured');

    // Parse header: t=1234567890,hmac_sha256=abcdef...
    const parts: Record<string, string> = {};
    for (const pair of signatureHeader.split(',')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        parts[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1);
      }
    }

    const timestamp = parts['t'];
    const signature = parts['hmac_sha256'];
    if (!timestamp || !signature) return false;

    // Replay protection: reject timestamps older than 5 minutes
    const ts = parseInt(timestamp, 10);
    if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

    // Compute HMAC-SHA256
    const signedContent = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedContent));
    const computed = Buffer.from(sig).toString('hex');

    // Constant-time comparison
    const { timingSafeEqual } = await import('node:crypto');
    const a = Buffer.from(signature);
    const b = Buffer.from(computed);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

/** Module-level singleton — token survives across requests */
export const paymentService = new PaymentService();
