import { supabase } from '../lib/supabase.js';
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from '../lib/errors.js';
import { captureServerEvent } from '../lib/analytics.js';
import type {
  OrganizerVendorAgreement,
  OrganizerSettlementOverview,
  OrganizerEventSettlementSummary,
  OrganizerEventVendorBreakdown,
  PlatformTerms,
  CreateAgreementPayload,
  UpdateAgreementPayload,
} from './organizer.types.js';

function toAgreement(row: any, vendorName?: string | null, eventName?: string | null): OrganizerVendorAgreement {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    vendorId: row.vendor_id,
    vendorName: vendorName ?? row.vendor_name ?? null,
    eventId: row.event_id,
    eventName: eventName ?? row.event_name ?? null,
    commissionRate: Number(row.commission_rate),
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class OrganizerService {
  // ─── Settlement Overview ──────────────────────────────────────────────────────

  async getSettlementOverview(organizerId: string): Promise<OrganizerSettlementOverview> {
    // 1. Get organizer's events
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, name, start_date, end_date')
      .eq('organizer_id', organizerId)
      .order('start_date', { ascending: false });

    if (eventsError) throw new Error(`Failed to fetch events: ${eventsError.message}`);
    if (!events || events.length === 0) {
      return {
        totalGrossRevenue: 0,
        totalNetRevenue: 0,
        totalCommissionEarned: 0,
        totalSettled: 0,
        totalPending: 0,
        totalUnsettled: 0,
        totalOrders: 0,
        platformFeePercent: 5,
        events: [],
      };
    }

    const eventIds = events.map((e: any) => e.id);

    // 2. Get completed orders for those events
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, event_id, vendor_id, total, service_fee, payment_status')
      .in('event_id', eventIds)
      .eq('payment_status', 'complete');

    if (ordersError) throw new Error(`Failed to fetch orders: ${ordersError.message}`);

    // 3. Get settled orders with batch status tracking
    const orderIds = (orders || []).map((o: any) => o.id);
    // Track which orders are settled vs pending (in draft/processing batch)
    const settledOrderSet = new Set<string>(); // orders in 'settled' batches
    const pendingOrderSet = new Set<string>(); // orders in 'draft' or 'processing' batches
    if (orderIds.length > 0) {
      const { data: settledRows } = await supabase
        .from('settlement_orders')
        .select('order_id, batch_id')
        .in('order_id', orderIds);

      if (settledRows && settledRows.length > 0) {
        const batchIds = [...new Set(settledRows.map((r: any) => r.batch_id))];
        const { data: batches } = await supabase
          .from('settlement_batches')
          .select('id, status')
          .in('id', batchIds);

        const batchStatusMap = new Map((batches || []).map((b: any) => [b.id, b.status]));

        for (const sr of settledRows) {
          const status = batchStatusMap.get(sr.batch_id);
          if (status === 'settled') {
            settledOrderSet.add(sr.order_id);
          } else if (status === 'draft' || status === 'processing') {
            pendingOrderSet.add(sr.order_id);
          }
        }
      }
    }

    // 4. Get platform fee
    const { data: configRow } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'platform_fee_percentage')
      .single();
    const platformFeePercent = Number(configRow?.value ?? 5);
    const platformFeeRate = platformFeePercent / 100;

    // 5. Get event_vendors counts
    const { data: evRows } = await supabase
      .from('event_vendors')
      .select('event_id, vendor_id')
      .in('event_id', eventIds);
    const vendorCountByEvent = new Map<string, number>();
    for (const ev of (evRows || [])) {
      vendorCountByEvent.set(ev.event_id, (vendorCountByEvent.get(ev.event_id) || 0) + 1);
    }

    // 6. Get active commission agreements for this organizer
    const { data: agreements } = await supabase
      .from('organizer_vendor_agreements')
      .select('vendor_id, event_id, commission_rate')
      .eq('organizer_id', organizerId)
      .eq('status', 'active');

    const commissionMap = new Map<string, number>(); // "eventId:vendorId" → rate
    for (const a of (agreements || [])) {
      commissionMap.set(`${a.event_id}:${a.vendor_id}`, Number(a.commission_rate));
    }

    // 7. Aggregate per event
    const eventMap = new Map(events.map((e: any) => [e.id, e]));
    const eventAgg: Record<string, {
      gross: number; serviceFees: number; orderCount: number;
      settledGross: number; pendingGross: number; unsettledGross: number;
      commissionEarned: number;
    }> = {};

    for (const eid of eventIds) {
      eventAgg[eid] = { gross: 0, serviceFees: 0, orderCount: 0, settledGross: 0, pendingGross: 0, unsettledGross: 0, commissionEarned: 0 };
    }

    for (const o of (orders || [])) {
      const agg = eventAgg[o.event_id];
      if (!agg) continue;
      const total = Number(o.total) || 0;
      const sf = Number(o.service_fee) || 0;
      agg.gross += total;
      agg.serviceFees += sf;
      agg.orderCount++;

      // Calculate commission for this order
      const rate = commissionMap.get(`${o.event_id}:${o.vendor_id}`) ?? 0;
      agg.commissionEarned += Math.round(total * rate / 100 * 100) / 100;

      if (settledOrderSet.has(o.id)) {
        agg.settledGross += total;
      } else if (pendingOrderSet.has(o.id)) {
        agg.pendingGross += total;
      } else {
        agg.unsettledGross += total;
      }
    }

    let totalGross = 0, totalNet = 0, totalCommissionEarned = 0, totalSettled = 0, totalPending = 0, totalUnsettled = 0, totalOrders = 0;
    const eventSummaries: OrganizerEventSettlementSummary[] = [];

    for (const eid of eventIds) {
      const agg = eventAgg[eid];
      const ev = eventMap.get(eid);
      const platformFees = Math.round(agg.gross * platformFeeRate * 100) / 100;
      const net = Math.round((agg.gross - agg.serviceFees - platformFees) * 100) / 100;

      // Calculate settled/pending/unsettled net proportionally
      const settledPf = Math.round(agg.settledGross * platformFeeRate * 100) / 100;
      const settledSf = agg.gross > 0 ? Math.round(agg.serviceFees * (agg.settledGross / agg.gross) * 100) / 100 : 0;
      const settledNet = Math.round((agg.settledGross - settledSf - settledPf) * 100) / 100;

      const pendingPf = Math.round(agg.pendingGross * platformFeeRate * 100) / 100;
      const pendingSf = agg.gross > 0 ? Math.round(agg.serviceFees * (agg.pendingGross / agg.gross) * 100) / 100 : 0;
      const pendingNet = Math.round((agg.pendingGross - pendingSf - pendingPf) * 100) / 100;

      const unsettledNet = Math.round((net - Math.max(settledNet, 0) - Math.max(pendingNet, 0)) * 100) / 100;

      totalGross += agg.gross;
      totalNet += net;
      totalCommissionEarned += agg.commissionEarned;
      totalSettled += Math.max(settledNet, 0);
      totalPending += Math.max(pendingNet, 0);
      totalUnsettled += Math.max(unsettledNet, 0);
      totalOrders += agg.orderCount;

      if (agg.orderCount > 0) {
        eventSummaries.push({
          eventId: eid,
          eventName: ev?.name ?? 'Unknown',
          eventStartDate: ev?.start_date,
          eventEndDate: ev?.end_date,
          vendorCount: vendorCountByEvent.get(eid) || 0,
          grossRevenue: Math.round(agg.gross * 100) / 100,
          serviceFees: Math.round(agg.serviceFees * 100) / 100,
          platformFees,
          netRevenue: net,
          commissionEarned: agg.commissionEarned,
          settledAmount: Math.max(settledNet, 0),
          pendingAmount: Math.max(pendingNet, 0),
          unsettledAmount: Math.max(unsettledNet, 0),
          orderCount: agg.orderCount,
        });
      }
    }

    return {
      totalGrossRevenue: Math.round(totalGross * 100) / 100,
      totalNetRevenue: Math.round(totalNet * 100) / 100,
      totalCommissionEarned: Math.round(totalCommissionEarned * 100) / 100,
      totalSettled: Math.round(totalSettled * 100) / 100,
      totalPending: Math.round(totalPending * 100) / 100,
      totalUnsettled: Math.round(totalUnsettled * 100) / 100,
      totalOrders,
      platformFeePercent,
      events: eventSummaries,
    };
  }

  // ─── Event Vendor Breakdown ───────────────────────────────────────────────────

  async getEventVendorBreakdown(organizerId: string, eventId: string): Promise<OrganizerEventVendorBreakdown[]> {
    // Assert organizer owns event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, organizer_id')
      .eq('id', eventId)
      .single();

    if (eventError || !event) throw new NotFoundError('Event not found');
    if (event.organizer_id !== organizerId) throw new ForbiddenError('Access denied');

    // Get orders for this event
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, vendor_id, total, service_fee, payment_status')
      .eq('event_id', eventId)
      .eq('payment_status', 'complete');

    if (ordersError) throw new Error(`Failed to fetch orders: ${ordersError.message}`);
    if (!orders || orders.length === 0) return [];

    // Get platform fee
    const { data: configRow } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'platform_fee_percentage')
      .single();
    const platformFeeRate = Number(configRow?.value ?? 5) / 100;

    // Get settled orders
    const orderIds = orders.map((o: any) => o.id);
    const settledSet = new Set<string>();
    if (orderIds.length > 0) {
      const { data: settledRows } = await supabase
        .from('settlement_orders')
        .select('order_id, batch_id')
        .in('order_id', orderIds);

      if (settledRows && settledRows.length > 0) {
        const batchIds = [...new Set(settledRows.map((r: any) => r.batch_id))];
        const { data: batches } = await supabase
          .from('settlement_batches')
          .select('id, status')
          .in('id', batchIds);
        const settledBatchIds = new Set((batches || []).filter((b: any) => b.status === 'settled').map((b: any) => b.id));
        for (const sr of settledRows) {
          if (settledBatchIds.has(sr.batch_id)) settledSet.add(sr.order_id);
        }
      }
    }

    // Get vendor names
    const vendorIds = [...new Set(orders.map((o: any) => o.vendor_id).filter(Boolean))];
    const { data: vendors } = vendorIds.length > 0
      ? await supabase.from('vendors').select('id, name').in('id', vendorIds)
      : { data: [] };
    const vendorNameMap = new Map((vendors || []).map((v: any) => [v.id, v.name]));

    // Get active commission agreements for vendors in this event
    const { data: agreements } = vendorIds.length > 0
      ? await supabase
          .from('organizer_vendor_agreements')
          .select('vendor_id, commission_rate')
          .eq('event_id', eventId)
          .eq('status', 'active')
          .in('vendor_id', vendorIds)
      : { data: [] };
    const commissionRateMap = new Map((agreements || []).map((a: any) => [a.vendor_id, Number(a.commission_rate)]));

    // Group by vendor
    const vendorAgg: Record<string, { gross: number; sf: number; count: number; settledGross: number }> = {};
    for (const o of orders) {
      const vid = o.vendor_id;
      if (!vid) continue;
      if (!vendorAgg[vid]) vendorAgg[vid] = { gross: 0, sf: 0, count: 0, settledGross: 0 };
      const total = Number(o.total) || 0;
      vendorAgg[vid].gross += total;
      vendorAgg[vid].sf += Number(o.service_fee) || 0;
      vendorAgg[vid].count++;
      if (settledSet.has(o.id)) vendorAgg[vid].settledGross += total;
    }

    return Object.entries(vendorAgg).map(([vid, agg]) => {
      const pf = Math.round(agg.gross * platformFeeRate * 100) / 100;
      const commRate = commissionRateMap.get(vid) ?? 0;
      const commFee = Math.round(agg.gross * commRate / 100 * 100) / 100;
      const net = Math.round((agg.gross - agg.sf - pf) * 100) / 100;
      const settledPf = Math.round(agg.settledGross * platformFeeRate * 100) / 100;
      const settledSf = agg.gross > 0 ? Math.round(agg.sf * (agg.settledGross / agg.gross) * 100) / 100 : 0;
      const settledNet = Math.round((agg.settledGross - settledSf - settledPf) * 100) / 100;

      return {
        vendorId: vid,
        vendorName: vendorNameMap.get(vid) || 'Unknown',
        grossRevenue: Math.round(agg.gross * 100) / 100,
        serviceFees: Math.round(agg.sf * 100) / 100,
        platformFees: pf,
        commissionRate: commRate,
        commissionFee: commFee,
        netRevenue: net,
        orderCount: agg.count,
        settledAmount: Math.max(settledNet, 0),
        pendingAmount: Math.max(net - settledNet, 0),
      };
    }).sort((a, b) => b.grossRevenue - a.grossRevenue);
  }

  // ─── Platform Terms ───────────────────────────────────────────────────────────

  async getPlatformTerms(): Promise<PlatformTerms> {
    const { data: configRow } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'platform_fee_percentage')
      .single();

    return {
      platformFeePercent: Number(configRow?.value ?? 5),
      serviceFeeInfo: 'A small service fee is added to each customer order at checkout. This fee covers payment processing and platform maintenance.',
      standardPayoutFee: 2.00,
      instantPayoutFee: 10.00,
      paymentTerms: 'Payouts are processed 24 hours after the event ends. Standard payouts arrive within 2 business days. Instant payouts arrive within minutes.',
    };
  }

  // ─── Agreement CRUD ───────────────────────────────────────────────────────────

  async listAgreements(organizerId: string, filters?: { eventId?: string; status?: string }): Promise<OrganizerVendorAgreement[]> {
    let query = supabase
      .from('organizer_vendor_agreements')
      .select('*')
      .eq('organizer_id', organizerId)
      .order('created_at', { ascending: false });

    if (filters?.eventId) query = query.eq('event_id', filters.eventId);
    if (filters?.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list agreements: ${error.message}`);

    if (!data || data.length === 0) return [];

    // Enrich with vendor & event names
    const vendorIds = [...new Set(data.map((a: any) => a.vendor_id))];
    const eventIds = [...new Set(data.map((a: any) => a.event_id))];

    const [vendorsResult, eventsResult] = await Promise.all([
      vendorIds.length > 0
        ? supabase.from('vendors').select('id, name').in('id', vendorIds)
        : Promise.resolve({ data: [] }),
      eventIds.length > 0
        ? supabase.from('events').select('id, name').in('id', eventIds)
        : Promise.resolve({ data: [] }),
    ]);

    const vendorMap = new Map((vendorsResult.data || []).map((v: any) => [v.id, v.name]));
    const eventMap = new Map((eventsResult.data || []).map((e: any) => [e.id, e.name]));

    return data.map((row: any) => toAgreement(row, vendorMap.get(row.vendor_id), eventMap.get(row.event_id)));
  }

  async getAgreement(organizerId: string, id: string): Promise<OrganizerVendorAgreement> {
    const { data, error } = await supabase
      .from('organizer_vendor_agreements')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundError('Agreement not found');
    if (data.organizer_id !== organizerId) throw new ForbiddenError('Access denied');

    // Get names
    const [vendorResult, eventResult] = await Promise.all([
      supabase.from('vendors').select('name').eq('id', data.vendor_id).single(),
      supabase.from('events').select('name').eq('id', data.event_id).single(),
    ]);

    return toAgreement(data, vendorResult.data?.name, eventResult.data?.name);
  }

  async createAgreement(organizerId: string, payload: CreateAgreementPayload): Promise<OrganizerVendorAgreement> {
    // Validate commission rate
    if (payload.commissionRate < 0 || payload.commissionRate > 50) {
      throw new ValidationError('Commission rate must be between 0% and 50%');
    }

    // Validate organizer owns event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, organizer_id, name')
      .eq('id', payload.eventId)
      .single();

    if (eventError || !event) throw new NotFoundError('Event not found');
    if (event.organizer_id !== organizerId) throw new ForbiddenError('You do not own this event');

    // Validate vendor is in event_vendors
    const { data: ev } = await supabase
      .from('event_vendors')
      .select('vendor_id')
      .eq('event_id', payload.eventId)
      .eq('vendor_id', payload.vendorId)
      .single();

    if (!ev) throw new ValidationError('Vendor is not associated with this event');

    // Get vendor name
    const { data: vendor } = await supabase
      .from('vendors')
      .select('name')
      .eq('id', payload.vendorId)
      .single();

    // Insert
    const { data: row, error: insertError } = await supabase
      .from('organizer_vendor_agreements')
      .insert({
        organizer_id: organizerId,
        vendor_id: payload.vendorId,
        event_id: payload.eventId,
        commission_rate: payload.commissionRate,
        effective_from: payload.effectiveFrom,
        effective_until: payload.effectiveUntil || null,
        notes: payload.notes || null,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        throw new ConflictError('An agreement already exists for this vendor and event');
      }
      throw new Error(`Failed to create agreement: ${insertError.message}`);
    }

    return toAgreement(row, vendor?.name, event.name);
  }

  async updateAgreement(organizerId: string, id: string, payload: UpdateAgreementPayload): Promise<OrganizerVendorAgreement> {
    // Validate commission rate if provided
    if (payload.commissionRate !== undefined && (payload.commissionRate < 0 || payload.commissionRate > 50)) {
      throw new ValidationError('Commission rate must be between 0% and 50%');
    }

    // Fetch and assert ownership
    const { data: existing, error } = await supabase
      .from('organizer_vendor_agreements')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !existing) throw new NotFoundError('Agreement not found');
    if (existing.organizer_id !== organizerId) throw new ForbiddenError('Access denied');

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (payload.commissionRate !== undefined) updates.commission_rate = payload.commissionRate;
    if (payload.status !== undefined) updates.status = payload.status;
    if (payload.effectiveFrom !== undefined) updates.effective_from = payload.effectiveFrom;
    if (payload.effectiveUntil !== undefined) updates.effective_until = payload.effectiveUntil;
    if (payload.notes !== undefined) updates.notes = payload.notes;

    const { data: row, error: updateError } = await supabase
      .from('organizer_vendor_agreements')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw new Error(`Failed to update agreement: ${updateError.message}`);

    // Get names
    const [vendorResult, eventResult] = await Promise.all([
      supabase.from('vendors').select('name').eq('id', row.vendor_id).single(),
      supabase.from('events').select('name').eq('id', row.event_id).single(),
    ]);

    return toAgreement(row, vendorResult.data?.name, eventResult.data?.name);
  }

  // ─── Vendor-facing Agreement Methods ─────────────────────────────────────────

  async getVendorAgreements(vendorId: string, filters?: { status?: string }): Promise<OrganizerVendorAgreement[]> {
    let query = supabase
      .from('organizer_vendor_agreements')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list vendor agreements: ${error.message}`);
    if (!data || data.length === 0) return [];

    // Enrich with vendor & event names
    const vendorIds = [...new Set(data.map((a: any) => a.vendor_id))];
    const eventIds = [...new Set(data.map((a: any) => a.event_id))];

    const [vendorsResult, eventsResult] = await Promise.all([
      vendorIds.length > 0
        ? supabase.from('vendors').select('id, name').in('id', vendorIds)
        : Promise.resolve({ data: [] }),
      eventIds.length > 0
        ? supabase.from('events').select('id, name').in('id', eventIds)
        : Promise.resolve({ data: [] }),
    ]);

    const vendorMap = new Map((vendorsResult.data || []).map((v: any) => [v.id, v.name]));
    const eventMap = new Map((eventsResult.data || []).map((e: any) => [e.id, e.name]));

    return data.map((row: any) => toAgreement(row, vendorMap.get(row.vendor_id), eventMap.get(row.event_id)));
  }

  async acceptAgreement(vendorId: string, agreementId: string, metadata?: { ip?: string }): Promise<OrganizerVendorAgreement> {
    const { data: existing, error } = await supabase
      .from('organizer_vendor_agreements')
      .select('*')
      .eq('id', agreementId)
      .single();

    if (error || !existing) throw new NotFoundError('Agreement not found');
    if (existing.vendor_id !== vendorId) throw new ForbiddenError('Access denied');
    if (existing.status !== 'draft') throw new ValidationError('Only draft agreements can be accepted');

    const { data: row, error: updateError } = await supabase
      .from('organizer_vendor_agreements')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', agreementId)
      .select()
      .single();

    if (updateError) throw new Error(`Failed to accept agreement: ${updateError.message}`);

    // Also update event_vendors status to 'accepted'
    await supabase
      .from('event_vendors')
      .update({ status: 'accepted' })
      .eq('event_id', row.event_id)
      .eq('vendor_id', vendorId);

    // Invalidate event caches so vendor shows up in event vendor lists
    const eventCacheKeys = [
      `events:all`,
      `events:id:${row.event_id}`,
    ];
    try { await (await import('../lib/redis.js')).cache.del(...eventCacheKeys); } catch {}

    const [vendorResult, eventResult] = await Promise.all([
      supabase.from('vendors').select('name').eq('id', row.vendor_id).single(),
      supabase.from('events').select('name').eq('id', row.event_id).single(),
    ]);

    captureServerEvent(vendorId, 'agreement_accepted', {
      agreementId,
      eventId: row.event_id,
      eventName: eventResult.data?.name,
      commissionRate: Number(row.commission_rate),
      acceptedAt: new Date().toISOString(),
      ip: metadata?.ip,
    });

    return toAgreement(row, vendorResult.data?.name, eventResult.data?.name);
  }

  async declineAgreement(vendorId: string, agreementId: string): Promise<OrganizerVendorAgreement> {
    const { data: existing, error } = await supabase
      .from('organizer_vendor_agreements')
      .select('*')
      .eq('id', agreementId)
      .single();

    if (error || !existing) throw new NotFoundError('Agreement not found');
    if (existing.vendor_id !== vendorId) throw new ForbiddenError('Access denied');
    if (existing.status !== 'draft') throw new ValidationError('Only draft agreements can be declined');

    const { data: row, error: updateError } = await supabase
      .from('organizer_vendor_agreements')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', agreementId)
      .select()
      .single();

    if (updateError) throw new Error(`Failed to decline agreement: ${updateError.message}`);

    // Update event_vendors status to 'declined'
    await supabase
      .from('event_vendors')
      .update({ status: 'declined' })
      .eq('event_id', row.event_id)
      .eq('vendor_id', vendorId);

    // Invalidate event caches
    const eventCacheKeys = [
      `events:all`,
      `events:id:${row.event_id}`,
    ];
    try { await (await import('../lib/redis.js')).cache.del(...eventCacheKeys); } catch {}

    const [vendorResult, eventResult] = await Promise.all([
      supabase.from('vendors').select('name').eq('id', row.vendor_id).single(),
      supabase.from('events').select('name').eq('id', row.event_id).single(),
    ]);

    captureServerEvent(vendorId, 'agreement_declined', {
      agreementId,
      eventId: row.event_id,
      eventName: eventResult.data?.name,
      commissionRate: Number(row.commission_rate),
      declinedAt: new Date().toISOString(),
    });

    return toAgreement(row, vendorResult.data?.name, eventResult.data?.name);
  }

  async deleteAgreement(organizerId: string, id: string): Promise<void> {
    const { data: existing, error } = await supabase
      .from('organizer_vendor_agreements')
      .select('id, organizer_id, status')
      .eq('id', id)
      .single();

    if (error || !existing) throw new NotFoundError('Agreement not found');
    if (existing.organizer_id !== organizerId) throw new ForbiddenError('Access denied');
    if (existing.status !== 'draft') throw new ValidationError('Only draft agreements can be deleted');

    const { error: deleteError } = await supabase
      .from('organizer_vendor_agreements')
      .delete()
      .eq('id', id);

    if (deleteError) throw new Error(`Failed to delete agreement: ${deleteError.message}`);
  }
}
