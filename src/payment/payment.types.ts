// Stitch Express API types

export interface StitchExpressTokenResponse {
  success: boolean;
  data: {
    accessToken: string;
  };
}

export interface StitchPaymentLinkResponse {
  success: boolean;
  data: {
    payment: {
      id: string;
      amount: number;
      status: string;
      paidAt: string | null;
      payerName: string | null;
      payerEmailAddress: string | null;
      payerPhoneNumber: string | null;
      link: string;
      merchantReference: string | null;
      expireAt: string | null;
    };
  };
}

/** Response from GET /api/v1/payment-links/{paymentId} */
export interface StitchPaymentStatusResponse {
  success: boolean;
  data: {
    payment: {
      id: string;
      amount: number;
      status: string; // "PENDING" | "PAID" | "SETTLED" | "EXPIRED" | "CANCELLED"
      paidAt: string | null;
      merchantReference: string | null;
    };
  };
}

/**
 * Stitch webhook event — flexible to handle both Express and Core formats.
 * Express: body.data.payment.{merchantReference, status}
 * Core:    body.data.paymentInitiationRequest.{externalReference, status}
 */
export interface StitchWebhookEvent {
  id: string;
  type: string;
  data: {
    // Express format
    payment?: {
      id: string;
      merchantReference: string;
      status: string; // "PAID" | "SETTLED" | "CANCELLED" | "EXPIRED"
    };
    // Core format (legacy)
    paymentInitiationRequest?: {
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
