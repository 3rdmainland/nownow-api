export type AgreementStatus = 'draft' | 'active' | 'expired';

export interface OrganizerVendorAgreement {
  id: string;
  organizerId: string;
  vendorId: string;
  vendorName: string | null;
  eventId: string;
  eventName: string | null;
  commissionRate: number;
  status: AgreementStatus;
  effectiveFrom: string;
  effectiveUntil: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgreementPayload {
  vendorId: string;
  eventId: string;
  commissionRate: number;
  effectiveFrom: string;
  effectiveUntil?: string;
  notes?: string;
}

export interface UpdateAgreementPayload {
  commissionRate?: number;
  status?: AgreementStatus;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
  notes?: string | null;
}

export interface OrganizerEventSettlementSummary {
  eventId: string;
  eventName: string;
  eventStartDate: string;
  eventEndDate: string;
  vendorCount: number;
  grossRevenue: number;
  serviceFees: number;
  platformFees: number;
  netRevenue: number;
  commissionEarned: number;
  settledAmount: number;
  pendingAmount: number;
  unsettledAmount: number;
  orderCount: number;
}

export interface OrganizerSettlementOverview {
  totalGrossRevenue: number;
  totalNetRevenue: number;
  totalCommissionEarned: number;
  totalSettled: number;
  totalPending: number;
  totalUnsettled: number;
  totalOrders: number;
  platformFeePercent: number;
  events: OrganizerEventSettlementSummary[];
}

export interface OrganizerEventVendorBreakdown {
  vendorId: string;
  vendorName: string;
  grossRevenue: number;
  serviceFees: number;
  platformFees: number;
  commissionRate: number;
  commissionFee: number;
  netRevenue: number;
  orderCount: number;
  settledAmount: number;
  pendingAmount: number;
}

export interface PlatformTerms {
  platformFeePercent: number;
  serviceFeeInfo: string;
  standardPayoutFee: number;
  instantPayoutFee: number;
  paymentTerms: string;
}
