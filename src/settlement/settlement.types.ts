export type PayoutType = 'standard' | 'instant';
export type SettlementBatchStatus = 'draft' | 'processing' | 'settled' | 'failed';
export type SettlementPayoutStatus = 'pending' | 'processing' | 'settled' | 'failed';
export type BankAccountType = 'cheque' | 'savings' | 'transmission' | 'current';

export interface VendorBankDetails {
  id: string;
  vendorId: string;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  branchCode: string;
  accountType: BankAccountType;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementBatch {
  id: string;
  startDate: string;
  endDate: string;
  status: SettlementBatchStatus;
  payoutType: PayoutType;
  payoutFeePerVendor: number;
  totalGross: number;
  totalServiceFees: number;
  totalPlatformFees: number;
  totalPayoutFees: number;
  totalNet: number;
  orderCount: number;
  vendorCount: number;
  notes: string | null;
  createdBy: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementPayout {
  id: string;
  batchId: string;
  vendorId: string;
  vendorName: string | null;
  grossAmount: number;
  serviceFee: number;
  platformFee: number;
  payoutFee: number;
  refundAmount: number;
  netAmount: number;
  orderCount: number;
  status: SettlementPayoutStatus;
  paymentReference: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementBatchWithPayouts extends SettlementBatch {
  payouts: SettlementPayout[];
}

export interface SettlementSummary {
  totalBatches: number;
  totalSettled: number;
  totalPending: number;
  totalPayoutFees: number;
  totalFailed: number;
}

export interface CreateBatchPayload {
  startDate: string;
  endDate: string;
  payoutType: PayoutType;
  notes?: string;
}

export interface UpsertBankDetailsPayload {
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  branchCode: string;
  accountType: BankAccountType;
}
