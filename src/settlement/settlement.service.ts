import { supabase } from '../lib/supabase.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { nanoid } from 'nanoid';
import {
  SettlementBatch,
  SettlementBatchWithPayouts,
  SettlementPayout,
  SettlementSummary,
  VendorBankDetails,
  CreateBatchPayload,
  UpsertBankDetailsPayload,
  PayoutType,
} from './settlement.types.js';

// Stitch payout fees (ZAR, ex VAT)
const PAYOUT_FEE_STANDARD = 2.00;
const PAYOUT_FEE_INSTANT = 10.00;

function payoutFeeForType(type: PayoutType): number {
  return type === 'instant' ? PAYOUT_FEE_INSTANT : PAYOUT_FEE_STANDARD;
}

function toBatch(row: any): SettlementBatch {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    payoutType: row.payout_type,
    payoutFeePerVendor: Number(row.payout_fee_per_vendor),
    totalGross: Number(row.total_gross),
    totalServiceFees: Number(row.total_service_fees),
    totalPlatformFees: Number(row.total_platform_fees),
    totalPayoutFees: Number(row.total_payout_fees),
    totalCommissionFees: Number(row.total_commission_fees ?? 0),
    totalNet: Number(row.total_net),
    orderCount: row.order_count,
    vendorCount: row.vendor_count,
    notes: row.notes,
    createdBy: row.created_by,
    settledAt: row.settled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPayout(row: any): SettlementPayout {
  return {
    id: row.id,
    batchId: row.batch_id,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    grossAmount: Number(row.gross_amount),
    serviceFee: Number(row.service_fee),
    platformFee: Number(row.platform_fee),
    commissionFee: Number(row.commission_fee ?? 0),
    commissionRate: Number(row.commission_rate ?? 0),
    payoutFee: Number(row.payout_fee),
    refundAmount: Number(row.refund_amount),
    netAmount: Number(row.net_amount),
    orderCount: row.order_count,
    eventId: row.event_id ?? null,
    organizerId: row.organizer_id ?? null,
    status: row.status,
    paymentReference: row.payment_reference,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBankDetails(row: any): VendorBankDetails {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    accountHolderName: row.account_holder_name,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    branchCode: row.branch_code,
    accountType: row.account_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SettlementService {
  async createBatch(payload: CreateBatchPayload, adminUserId: string): Promise<SettlementBatchWithPayouts> {
    const { startDate, endDate, payoutType, notes } = payload;

    // 1. Query completed orders in date range (include event_id)
    const { data: allOrders, error: ordersError } = await supabase
      .from('orders')
      .select('id, total, service_fee, vendor_id, event_id, refund_amount')
      .eq('payment_status', 'complete')
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59.999Z');

    if (ordersError) throw new Error(`Failed to fetch orders: ${ordersError.message}`);

    // 2. Exclude already-settled orders
    const orderIds = (allOrders || []).map((o: any) => o.id);
    let settledOrderIds = new Set<string>();
    if (orderIds.length > 0) {
      const { data: settled } = await supabase
        .from('settlement_orders')
        .select('order_id')
        .in('order_id', orderIds);
      settledOrderIds = new Set((settled || []).map((s: any) => s.order_id));
    }

    const unsettledOrders = (allOrders || []).filter((o: any) => !settledOrderIds.has(o.id));

    if (unsettledOrders.length === 0) {
      throw new ValidationError('No unsettled orders found in the given date range');
    }

    // 3. Get platform fee percentage from config
    const { data: configRow } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'platform_fee_percentage')
      .single();
    const platformFeePercent = Number(configRow?.value ?? 5) / 100;

    // 4. Get vendor names
    const vendorIds = [...new Set(unsettledOrders.map((o: any) => o.vendor_id).filter(Boolean))];
    const { data: vendors } = vendorIds.length > 0
      ? await supabase.from('vendors').select('id, name').in('id', vendorIds)
      : { data: [] };
    const vendorMap = new Map((vendors || []).map((v: any) => [v.id, v.name]));

    // 5. Fetch active commission agreements for all vendor+event combos
    const eventIds = [...new Set(unsettledOrders.map((o: any) => o.event_id).filter(Boolean))];
    const agreementMap = new Map<string, { commissionRate: number; organizerId: string }>();
    if (vendorIds.length > 0 && eventIds.length > 0) {
      const { data: agreements } = await supabase
        .from('organizer_vendor_agreements')
        .select('vendor_id, event_id, commission_rate, organizer_id')
        .eq('status', 'active')
        .in('vendor_id', vendorIds)
        .in('event_id', eventIds);

      for (const a of (agreements || [])) {
        agreementMap.set(`${a.vendor_id}:${a.event_id}`, {
          commissionRate: Number(a.commission_rate),
          organizerId: a.organizer_id,
        });
      }
    }

    // 6. Group by vendor:event for per-agreement payout rows
    const groupAgg: Record<string, { vendorId: string; eventId: string | null; gross: number; serviceFee: number; refunds: number; orders: any[] }> = {};
    for (const o of unsettledOrders) {
      const vid = o.vendor_id;
      if (!vid) continue;
      const eid = o.event_id || '__none__';
      const key = `${vid}:${eid}`;
      if (!groupAgg[key]) groupAgg[key] = { vendorId: vid, eventId: o.event_id || null, gross: 0, serviceFee: 0, refunds: 0, orders: [] };
      groupAgg[key].gross += Number(o.total) || 0;
      groupAgg[key].serviceFee += Number(o.service_fee) || 0;
      groupAgg[key].refunds += Number(o.refund_amount) || 0;
      groupAgg[key].orders.push(o);
    }

    const feePerVendor = payoutFeeForType(payoutType);
    const groupEntries = Object.entries(groupAgg);

    // Track unique vendors for payout fee (one fee per vendor, not per vendor-event)
    const vendorsWithFee = new Set<string>();

    // 7. Calculate totals
    let totalGross = 0;
    let totalServiceFees = 0;
    let totalPlatformFees = 0;
    let totalPayoutFees = 0;
    let totalCommissionFees = 0;
    let totalNet = 0;

    const payoutRows: any[] = [];
    for (const [, agg] of groupEntries) {
      const platformFee = Math.round(agg.gross * platformFeePercent * 100) / 100;

      // Look up commission agreement
      const agreement = agg.eventId ? agreementMap.get(`${agg.vendorId}:${agg.eventId}`) : undefined;
      const commissionRate = agreement?.commissionRate ?? 0;
      const organizerId = agreement?.organizerId ?? null;
      const commissionFee = Math.round(agg.gross * commissionRate / 100 * 100) / 100;

      // Only charge payout fee once per vendor
      const vendorPayoutFee = vendorsWithFee.has(agg.vendorId) ? 0 : feePerVendor;
      vendorsWithFee.add(agg.vendorId);

      const net = Math.round((agg.gross - agg.serviceFee - commissionFee - platformFee - vendorPayoutFee - agg.refunds) * 100) / 100;

      totalGross += agg.gross;
      totalServiceFees += agg.serviceFee;
      totalPlatformFees += platformFee;
      totalPayoutFees += vendorPayoutFee;
      totalCommissionFees += commissionFee;
      totalNet += net;

      payoutRows.push({
        vendor_id: agg.vendorId,
        vendor_name: vendorMap.get(agg.vendorId) || null,
        gross_amount: agg.gross,
        service_fee: agg.serviceFee,
        platform_fee: platformFee,
        commission_fee: commissionFee,
        commission_rate: commissionRate,
        payout_fee: vendorPayoutFee,
        refund_amount: agg.refunds,
        net_amount: net,
        order_count: agg.orders.length,
        event_id: agg.eventId,
        organizer_id: organizerId,
        status: 'pending',
      });
    }

    // 8. Insert settlement_orders FIRST (race condition protection via unique constraint)
    const orderRows = unsettledOrders
      .filter((o: any) => o.vendor_id)
      .map((o: any) => {
        const agreement = o.event_id ? agreementMap.get(`${o.vendor_id}:${o.event_id}`) : undefined;
        const rate = agreement?.commissionRate ?? 0;
        const orderCommission = Math.round(Number(o.total) * rate / 100 * 100) / 100;
        return {
          order_id: o.id,
          batch_id: '__pending__', // placeholder, updated after batch insert
          vendor_id: o.vendor_id,
          event_id: o.event_id || null,
          order_total: Number(o.total) || 0,
          service_fee: Number(o.service_fee) || 0,
          commission_fee: orderCommission,
        };
      });

    // 9. Insert batch
    const { data: batchRow, error: batchError } = await supabase
      .from('settlement_batches')
      .insert({
        start_date: startDate,
        end_date: endDate,
        status: 'draft',
        payout_type: payoutType,
        payout_fee_per_vendor: feePerVendor,
        total_gross: Math.round(totalGross * 100) / 100,
        total_service_fees: Math.round(totalServiceFees * 100) / 100,
        total_platform_fees: Math.round(totalPlatformFees * 100) / 100,
        total_payout_fees: Math.round(totalPayoutFees * 100) / 100,
        total_commission_fees: Math.round(totalCommissionFees * 100) / 100,
        total_net: Math.round(totalNet * 100) / 100,
        order_count: unsettledOrders.length,
        vendor_count: vendorsWithFee.size,
        notes: notes || null,
        created_by: adminUserId,
      })
      .select()
      .single();

    if (batchError) throw new Error(`Failed to create batch: ${batchError.message}`);

    // 10. Insert payouts
    const payoutsToInsert = payoutRows.map(p => ({ ...p, batch_id: batchRow.id }));
    const { data: payoutData, error: payoutError } = await supabase
      .from('settlement_payouts')
      .insert(payoutsToInsert)
      .select();

    if (payoutError) throw new Error(`Failed to create payouts: ${payoutError.message}`);

    // 11. Insert settlement_orders with actual batch_id
    if (orderRows.length > 0) {
      const soRows = orderRows.map(r => ({ ...r, batch_id: batchRow.id }));
      const { error: soError } = await supabase
        .from('settlement_orders')
        .insert(soRows);
      if (soError) throw new Error(`Failed to link orders: ${soError.message}`);
    }

    return {
      ...toBatch(batchRow),
      payouts: (payoutData || []).map(toPayout),
    };
  }

  async listBatches(params: { status?: string; page?: number; limit?: number }): Promise<{ batches: SettlementBatch[]; total: number }> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('settlement_batches')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (params.status) {
      query = query.eq('status', params.status);
    }

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to list batches: ${error.message}`);

    return {
      batches: (data || []).map(toBatch),
      total: count || 0,
    };
  }

  async getBatch(id: string): Promise<SettlementBatchWithPayouts> {
    const { data: batchRow, error } = await supabase
      .from('settlement_batches')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !batchRow) throw new NotFoundError('Settlement batch not found');

    const { data: payoutData } = await supabase
      .from('settlement_payouts')
      .select('*')
      .eq('batch_id', id)
      .order('net_amount', { ascending: false });

    return {
      ...toBatch(batchRow),
      payouts: (payoutData || []).map(toPayout),
    };
  }

  async processBatch(batchId: string): Promise<SettlementBatchWithPayouts> {
    // 1. Get batch and assert status
    const { data: batchRow, error } = await supabase
      .from('settlement_batches')
      .select('*')
      .eq('id', batchId)
      .single();

    if (error || !batchRow) throw new NotFoundError('Settlement batch not found');
    if (batchRow.status !== 'draft' && batchRow.status !== 'failed') {
      throw new ValidationError(`Cannot process batch with status "${batchRow.status}". Must be draft or failed.`);
    }

    // 2. Set batch → processing
    await supabase
      .from('settlement_batches')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', batchId);

    // 3. Get payouts
    const { data: payouts } = await supabase
      .from('settlement_payouts')
      .select('*')
      .eq('batch_id', batchId);

    // 4. DUMMY: mark each payout settled with a dummy reference
    for (const p of (payouts || [])) {
      const ref = `DUMMY-${nanoid(8)}`;
      await supabase
        .from('settlement_payouts')
        .update({
          status: 'settled',
          payment_reference: ref,
          updated_at: new Date().toISOString(),
        })
        .eq('id', p.id);
    }

    // 5. Set batch → settled
    const now = new Date().toISOString();
    await supabase
      .from('settlement_batches')
      .update({ status: 'settled', settled_at: now, updated_at: now })
      .eq('id', batchId);

    return this.getBatch(batchId);
  }

  async retryBatch(batchId: string): Promise<SettlementBatchWithPayouts> {
    const { data: batchRow, error } = await supabase
      .from('settlement_batches')
      .select('*')
      .eq('id', batchId)
      .single();

    if (error || !batchRow) throw new NotFoundError('Settlement batch not found');
    if (batchRow.status !== 'failed') {
      throw new ValidationError(`Cannot retry batch with status "${batchRow.status}". Must be failed.`);
    }

    // Reset failed payouts to pending
    await supabase
      .from('settlement_payouts')
      .update({ status: 'pending', failure_reason: null, updated_at: new Date().toISOString() })
      .eq('batch_id', batchId)
      .eq('status', 'failed');

    // Reset batch to draft
    await supabase
      .from('settlement_batches')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', batchId);

    return this.processBatch(batchId);
  }

  async getSummary(): Promise<SettlementSummary> {
    const { data: batches, error } = await supabase
      .from('settlement_batches')
      .select('status, total_net, total_payout_fees, total_commission_fees');

    if (error) throw new Error(`Failed to fetch summary: ${error.message}`);

    let totalBatches = 0;
    let totalSettled = 0;
    let totalPending = 0;
    let totalPayoutFees = 0;
    let totalCommissionFees = 0;
    let totalFailed = 0;

    for (const b of (batches || [])) {
      totalBatches++;
      const net = Number(b.total_net) || 0;
      const fees = Number(b.total_payout_fees) || 0;
      const commission = Number(b.total_commission_fees) || 0;

      if (b.status === 'settled') {
        totalSettled += net;
        totalPayoutFees += fees;
        totalCommissionFees += commission;
      } else if (b.status === 'draft' || b.status === 'processing') {
        totalPending += net;
      } else if (b.status === 'failed') {
        totalFailed += net;
      }
    }

    return {
      totalBatches,
      totalSettled: Math.round(totalSettled * 100) / 100,
      totalPending: Math.round(totalPending * 100) / 100,
      totalPayoutFees: Math.round(totalPayoutFees * 100) / 100,
      totalCommissionFees: Math.round(totalCommissionFees * 100) / 100,
      totalFailed: Math.round(totalFailed * 100) / 100,
    };
  }

  async getVendorPayouts(vendorId: string, params: { page?: number; limit?: number }): Promise<{ payouts: SettlementPayout[]; total: number }> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from('settlement_payouts')
      .select('*', { count: 'exact' })
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Failed to fetch vendor payouts: ${error.message}`);

    return {
      payouts: (data || []).map(toPayout),
      total: count || 0,
    };
  }

  async upsertBankDetails(vendorId: string, payload: UpsertBankDetailsPayload): Promise<VendorBankDetails> {
    // Check if exists
    const { data: existing } = await supabase
      .from('vendor_bank_details')
      .select('id')
      .eq('vendor_id', vendorId)
      .single();

    const row = {
      vendor_id: vendorId,
      account_holder_name: payload.accountHolderName,
      bank_name: payload.bankName,
      account_number: payload.accountNumber,
      branch_code: payload.branchCode,
      account_type: payload.accountType,
      updated_at: new Date().toISOString(),
    };

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('vendor_bank_details')
        .update(row)
        .eq('vendor_id', vendorId)
        .select()
        .single();
      if (error) throw new Error(`Failed to update bank details: ${error.message}`);
      result = data;
    } else {
      const { data, error } = await supabase
        .from('vendor_bank_details')
        .insert(row)
        .select()
        .single();
      if (error) throw new Error(`Failed to insert bank details: ${error.message}`);
      result = data;
    }

    return toBankDetails(result);
  }

  async getBankDetails(vendorId: string): Promise<VendorBankDetails> {
    const { data, error } = await supabase
      .from('vendor_bank_details')
      .select('*')
      .eq('vendor_id', vendorId)
      .single();

    if (error || !data) throw new NotFoundError('Bank details not found for this vendor');
    return toBankDetails(data);
  }

  async getVendorSettlementSummary(vendorId: string): Promise<{
    totalEarned: number;
    totalPending: number;
    payoutCount: number;
    lastPayoutDate: string | null;
    lastPayoutAmount: number | null;
    hasBankDetails: boolean;
    // Order-based stats so vendors see revenue before settlements are processed
    orderRevenue: number;
    orderCount: number;
    avgOrderValue: number;
    unsettledRevenue: number;
  }> {
    // Parallel: payouts, bank details, and order stats
    const [payoutsResult, bankResult, ordersResult] = await Promise.all([
      supabase
        .from('settlement_payouts')
        .select('net_amount, status, created_at')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false }),
      supabase
        .from('vendor_bank_details')
        .select('id')
        .eq('vendor_id', vendorId)
        .single(),
      supabase
        .from('orders')
        .select('total, status')
        .eq('vendor_id', vendorId),
    ]);

    if (payoutsResult.error) throw new Error(`Failed to fetch vendor summary: ${payoutsResult.error.message}`);

    let totalEarned = 0;
    let totalPending = 0;
    let payoutCount = 0;
    let lastPayoutDate: string | null = null;
    let lastPayoutAmount: number | null = null;

    for (const p of (payoutsResult.data || [])) {
      const net = Number(p.net_amount) || 0;
      if (p.status === 'settled') {
        totalEarned += net;
        payoutCount++;
        if (!lastPayoutDate) {
          lastPayoutDate = p.created_at;
          lastPayoutAmount = net;
        }
      } else if (p.status === 'pending' || p.status === 'processing') {
        totalPending += net;
      }
    }

    // Order-based revenue (collected orders = confirmed revenue)
    const orders = (ordersResult.data || []) as Array<{ total: number; status: string }>;
    const collected = orders.filter(o => o.status === 'COLLECTED');
    const nonCancelled = orders.filter(o => o.status !== 'CANCELLED');
    const orderRevenue = collected.reduce((sum, o) => sum + Number(o.total), 0);
    const orderCount = nonCancelled.length;
    const avgOrderValue = orderCount > 0 ? orderRevenue / collected.length : 0;
    // Revenue from collected orders minus what has already been settled
    const unsettledRevenue = Math.max(0, orderRevenue - totalEarned);

    return {
      totalEarned: Math.round(totalEarned * 100) / 100,
      totalPending: Math.round(totalPending * 100) / 100,
      payoutCount,
      lastPayoutDate,
      lastPayoutAmount,
      hasBankDetails: !!bankResult.data,
      orderRevenue: Math.round(orderRevenue * 100) / 100,
      orderCount,
      avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      unsettledRevenue: Math.round(unsettledRevenue * 100) / 100,
    };
  }
}
