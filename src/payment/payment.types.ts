// Stitch Express API types

export interface StitchClientTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface StitchPaymentRequestResponse {
  clientPaymentInitiationRequestCreate: {
    paymentInitiationRequest: {
      id: string;
      url: string;
    } | null;
  };
}

export interface StitchWebhookEvent {
  id: string;
  type: string;
  data: {
    paymentInitiationRequest: {
      id: string;
      externalReference: string;
      status: string; // "complete" | "cancelled" | "expired"
    };
    amount?: {
      quantity: string;
      currency: string;
    };
  };
}

export interface CreatePaymentResult {
  paymentId: string;
  paymentUrl: string;
}
