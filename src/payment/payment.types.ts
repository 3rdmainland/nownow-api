// Stitch REST v2 API types

export interface StitchOAuthTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface StitchPaymentRequestBody {
  amount: { currency: 'ZAR'; quantity: number };
  externalReference: string;
  expireAt: string;
  payer: {
    identifier: string;
    fullName: string;
    mobileNumber?: string;
  };
  paymentMethods: {
    eft: {
      enabled: boolean;
      payerReference: string;
      beneficiaryReference: string;
      beneficiary: {
        name: string;
        bank: string;
        accountNumber: string;
      };
      capitecPay?: { enabled: boolean };
    };
    card: { enabled: boolean };
  };
}

export interface StitchPaymentResponse {
  id: string;
  amount: { currency: string; quantity: number };
  externalReference: string;
  status: 'pending' | 'completed' | 'cancelled' | 'expired';
  interaction: {
    type: 'redirect';
    url: string;
  };
}

/**
 * Stitch REST v2 webhook payload.
 * Dispatched for payment, payment.confirmation, refund events.
 */
export interface StitchWebhookEvent {
  data: {
    client: {
      paymentInitiationRequests: {
        node: {
          __typename: string;
          id: string;
          amount: { currency: string; quantity: string };
          state: {
            __typename:
              | 'PaymentInitiationRequestCompleted'
              | 'PaymentInitiationRequestCancelled'
              | 'PaymentInitiationRequestExpired';
            date: string;
            payer?: { accountNumber: string; bankId: string };
          };
          externalReference?: string;
        };
      };
    };
  };
}

export interface CreatePaymentResult {
  paymentId: string;
  paymentUrl: string;
}
