import {
  StitchClientTokenResponse,
  StitchPaymentRequestResponse,
  CreatePaymentResult,
} from './payment.types.js';
import { ServiceUnavailableError, InternalError } from '../lib/errors.js';

export class PaymentService {
  private clientToken: string | null = null;
  private tokenExpiresAt: number = 0;

  /**
   * Get a client token from Stitch OAuth2 endpoint.
   * Tokens are cached until expiry.
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

    const res = await fetch('https://secure.stitch.money/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'client_paymentrequest',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ServiceUnavailableError(`Stitch token request failed: ${res.status} ${text}`);
    }

    const data: StitchClientTokenResponse = await res.json();
    this.clientToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    return this.clientToken;
  }

  /**
   * Create a payment request via Stitch GraphQL API.
   * Returns the payment ID and redirect URL.
   */
  async createPaymentRequest(
    orderId: string,
    amountInCents: number,
    vendorName: string
  ): Promise<CreatePaymentResult> {
    const token = await this.getClientToken();

    const redirectUrl = `${process.env.STITCH_REDIRECT_BASE_URL}/checkout/payment-callback`;

    const mutation = `
      mutation CreatePaymentRequest(
        $amount: MoneyInput!,
        $externalReference: String!,
        $beneficiary: BeneficiaryInput!,
        $merchant: MerchantInput!,
        $paymentMethods: PaymentMethodsInput
      ) {
        clientPaymentInitiationRequestCreate(input: {
          amount: $amount,
          externalReference: $externalReference,
          beneficiary: $beneficiary,
          merchant: $merchant,
          paymentMethods: $paymentMethods
        }) {
          paymentInitiationRequest {
            id
            url
          }
        }
      }
    `;

    const variables = {
      amount: {
        quantity: amountInCents.toString(),
        currency: 'ZAR',
      },
      externalReference: orderId,
      beneficiary: {
        bankAccount: {
          name: process.env.STITCH_BENEFICIARY_NAME,
          bankId: process.env.STITCH_BENEFICIARY_BANK_ID,
          accountNumber: process.env.STITCH_BENEFICIARY_ACCOUNT,
          accountType: process.env.STITCH_BENEFICIARY_ACCOUNT_TYPE || 'current',
          beneficiaryType: process.env.STITCH_BENEFICIARY_TYPE || 'private',
          reference: `NowNow-${orderId.slice(0, 12)}`,
        },
      },
      merchant: {
        name: vendorName,
        url: process.env.STITCH_REDIRECT_BASE_URL || 'https://nownow.co.za',
      },
      paymentMethods: {
        card: { enabled: true },
        applePay: { enabled: true },
        googlePay: { enabled: true },
      },
    };

    const apiUrl = process.env.STITCH_API_URL || 'https://api.stitch.money/graphql';

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ServiceUnavailableError(`Stitch payment request failed: ${res.status} ${text}`);
    }

    const json: { data: StitchPaymentRequestResponse; errors?: Array<{ message: string }> } =
      await res.json();

    if (json.errors?.length) {
      throw new ServiceUnavailableError(
        `Stitch GraphQL error: ${json.errors.map(e => e.message).join(', ')}`
      );
    }

    const result = json.data.clientPaymentInitiationRequestCreate.paymentInitiationRequest;
    if (!result) {
      throw new InternalError('Stitch returned null payment request');
    }

    return {
      paymentId: result.id,
      paymentUrl: `${result.url}?redirect_uri=${encodeURIComponent(redirectUrl)}`,
    };
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
