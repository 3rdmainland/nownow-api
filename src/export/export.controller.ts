import { FastifyPluginAsync } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { emailCSVExport } from '../lib/export.js';
import { authenticate, authenticateOrganizer, assertOrganizerOwnsEvent } from '../lib/auth.js';
import { authenticateAdmin } from '../lib/auth.js';
import { ValidationError } from '../lib/errors.js';

const exportController: FastifyPluginAsync = async (fastify) => {

    // ── Vendor: Export my orders ──────────────────────────────────────────
    fastify.post('/vendor/orders', { preHandler: [authenticate] }, async (request, reply) => {
        const { vendorId, email } = request.user as { vendorId: string; email: string };
        const { eventId, startDate, endDate } = request.body as { eventId?: string; startDate?: string; endDate?: string };

        let query = supabase
            .from('orders')
            .select('id, phone, items, total, status, payment_method, payment_status, service_fee, created_at, collected_at, estimated_prep_time, queue_position, refund_status, refund_amount')
            .eq('vendor_id', vendorId)
            .order('created_at', { ascending: false })
            .limit(10000);

        if (eventId) query = query.eq('event_id', eventId);
        if (startDate) query = query.gte('created_at', startDate);
        if (endDate) query = query.lte('created_at', endDate);

        const { data: orders, error } = await query;
        if (error) throw new Error(`Export failed: ${error.message}`);

        const rows = (orders || []).map((o: any) => ({
            order_id: o.id,
            phone: o.phone,
            items: Array.isArray(o.items)
                ? o.items.map((i: any) => `${i.name} x${i.quantity}`).join('; ')
                : '',
            total: o.total,
            service_fee: o.service_fee || 0,
            status: o.status,
            payment_method: o.payment_method,
            payment_status: o.payment_status,
            prep_time: o.estimated_prep_time,
            refund_status: o.refund_status || 'none',
            refund_amount: o.refund_amount || 0,
            created_at: o.created_at,
            collected_at: o.collected_at || '',
        }));

        const dateLabel = startDate && endDate ? `${startDate}_${endDate}` : new Date().toISOString().split('T')[0];

        void emailCSVExport({
            to: email,
            subject: `Orders Export — ${dateLabel}`,
            filename: `orders-${dateLabel}.csv`,
            rows,
            columns: [
                { key: 'order_id', label: 'Order ID' },
                { key: 'phone', label: 'Phone' },
                { key: 'items', label: 'Items' },
                { key: 'total', label: 'Total (R)' },
                { key: 'service_fee', label: 'Service Fee (R)' },
                { key: 'status', label: 'Status' },
                { key: 'payment_method', label: 'Payment Method' },
                { key: 'payment_status', label: 'Payment Status' },
                { key: 'prep_time', label: 'Prep Time (min)' },
                { key: 'refund_status', label: 'Refund Status' },
                { key: 'refund_amount', label: 'Refund Amount (R)' },
                { key: 'created_at', label: 'Created' },
                { key: 'collected_at', label: 'Collected' },
            ],
            message: `Your orders export for ${dateLabel} is attached.`,
        }).catch(err => console.error('Failed to email orders export:', err?.message || err));

        return { message: 'Export started. You\'ll receive an email shortly.' };
    });

    // ── Organizer: Export event vendor breakdown ──────────────────────────
    fastify.post('/organizer/event-breakdown', { preHandler: [authenticateOrganizer] }, async (request, reply) => {
        const { email } = request.user as { email: string };
        const { eventId } = request.body as { eventId: string };

        if (!eventId) throw new ValidationError('eventId is required');
        await assertOrganizerOwnsEvent(request, eventId);

        const { data: orders, error } = await supabase
            .from('orders')
            .select('vendor_id, total, service_fee, payment_method, status')
            .eq('event_id', eventId)
            .in('payment_status', ['complete', 'pay_at_stall']);

        if (error) throw new Error(`Export failed: ${error.message}`);

        // Aggregate by vendor
        const vendorMap = new Map<string, { gross: number; fees: number; orders: number }>();
        for (const o of (orders || [])) {
            const entry = vendorMap.get(o.vendor_id) || { gross: 0, fees: 0, orders: 0 };
            entry.gross += Number(o.total) || 0;
            entry.fees += Number(o.service_fee) || 0;
            entry.orders++;
            vendorMap.set(o.vendor_id, entry);
        }

        // Get vendor names
        const vendorIds = [...vendorMap.keys()];
        const { data: vendors } = await supabase
            .from('vendors')
            .select('id, name')
            .in('id', vendorIds);

        const vendorNames = new Map((vendors || []).map((v: any) => [v.id, v.name]));

        const rows = vendorIds.map(id => {
            const v = vendorMap.get(id)!;
            return {
                vendor_name: vendorNames.get(id) || id,
                orders: v.orders,
                gross_sales: v.gross.toFixed(2),
                service_fees: v.fees.toFixed(2),
                net: (v.gross - v.fees).toFixed(2),
            };
        });

        void emailCSVExport({
            to: email,
            subject: `Event Vendor Breakdown — ${eventId.slice(0, 8)}`,
            filename: `event-breakdown-${eventId.slice(0, 8)}.csv`,
            rows,
            columns: [
                { key: 'vendor_name', label: 'Vendor' },
                { key: 'orders', label: 'Orders' },
                { key: 'gross_sales', label: 'Gross Sales (R)' },
                { key: 'service_fees', label: 'Service Fees (R)' },
                { key: 'net', label: 'Net (R)' },
            ],
        }).catch(err => console.error('Failed to email event breakdown:', err?.message || err));

        return { message: 'Export started. You\'ll receive an email shortly.' };
    });

    // ── Organizer: Export settlements overview ──────────────────────────
    fastify.post('/organizer/settlements-overview', { preHandler: [authenticateOrganizer] }, async (request, reply) => {
        const user = request.user as { userId: string; email: string };

        // Get all events owned by this organizer
        const { data: events, error: eventsError } = await supabase
            .from('events')
            .select('id, name, start_date, end_date, status')
            .eq('organizer_id', user.userId)
            .eq('origin_type', 'organizer')
            .order('start_date', { ascending: false });

        if (eventsError) throw new Error(`Export failed: ${eventsError.message}`);
        if (!events || events.length === 0) {
            void emailCSVExport({
                to: user.email,
                subject: 'Settlements Overview',
                filename: 'settlements-overview.csv',
                rows: [],
                message: 'No events found.',
            });
            return { message: 'Export started. You\'ll receive an email shortly.' };
        }

        const eventIds = events.map(e => e.id);

        // Get order aggregations per event
        const { data: orders } = await supabase
            .from('orders')
            .select('event_id, total, service_fee, status')
            .in('event_id', eventIds)
            .in('payment_status', ['complete', 'pay_at_stall']);

        // Get vendor counts per event
        const { data: eventVendors } = await supabase
            .from('event_vendors')
            .select('event_id, vendor_id')
            .in('event_id', eventIds)
            .eq('status', 'accepted');

        // Aggregate
        const ordersByEvent = new Map<string, { orders: number; gross: number; fees: number }>();
        for (const o of (orders || [])) {
            if (o.status === 'CANCELLED') continue;
            const entry = ordersByEvent.get(o.event_id) || { orders: 0, gross: 0, fees: 0 };
            entry.orders++;
            entry.gross += Number(o.total) || 0;
            entry.fees += Number(o.service_fee) || 0;
            ordersByEvent.set(o.event_id, entry);
        }

        const vendorsByEvent = new Map<string, number>();
        for (const ev of (eventVendors || [])) {
            vendorsByEvent.set(ev.event_id, (vendorsByEvent.get(ev.event_id) || 0) + 1);
        }

        const rows = events.map(e => {
            const stats = ordersByEvent.get(e.id) || { orders: 0, gross: 0, fees: 0 };
            return {
                event_name: e.name,
                status: e.status,
                start_date: e.start_date,
                end_date: e.end_date,
                vendors: vendorsByEvent.get(e.id) || 0,
                total_orders: stats.orders,
                gross_revenue: stats.gross.toFixed(2),
                service_fees: stats.fees.toFixed(2),
                net_revenue: (stats.gross - stats.fees).toFixed(2),
            };
        });

        void emailCSVExport({
            to: user.email,
            subject: 'Settlements Overview',
            filename: `settlements-overview-${new Date().toISOString().split('T')[0]}.csv`,
            rows,
            columns: [
                { key: 'event_name', label: 'Event' },
                { key: 'status', label: 'Status' },
                { key: 'start_date', label: 'Start Date' },
                { key: 'end_date', label: 'End Date' },
                { key: 'vendors', label: 'Vendors' },
                { key: 'total_orders', label: 'Total Orders' },
                { key: 'gross_revenue', label: 'Gross Revenue (R)' },
                { key: 'service_fees', label: 'Service Fees (R)' },
                { key: 'net_revenue', label: 'Net Revenue (R)' },
            ],
        }).catch(err => console.error('Failed to email settlements overview:', err?.message || err));

        return { message: 'Export started. You\'ll receive an email shortly.' };
    });

    // ── Admin: Export reconciliation report ───────────────────────────────
    fastify.post('/admin/reconciliation', { preHandler: [authenticateAdmin] }, async (request, reply) => {
        const { email } = request.user as { email: string };
        const { startDate, endDate } = request.body as { startDate: string; endDate: string };

        if (!startDate || !endDate) throw new ValidationError('startDate and endDate are required');

        const { data: orders, error } = await supabase
            .from('orders')
            .select('id, vendor_id, total, service_fee, payment_method, payment_status, status, refund_status, refund_amount, created_at')
            .gte('created_at', startDate)
            .lte('created_at', endDate)
            .in('payment_status', ['complete', 'pay_at_stall'])
            .order('created_at', { ascending: false })
            .limit(50000);

        if (error) throw new Error(`Export failed: ${error.message}`);

        // Get vendor names
        const vendorIds = [...new Set((orders || []).map((o: any) => o.vendor_id))];
        const { data: vendors } = await supabase.from('vendors').select('id, name').in('id', vendorIds);
        const vendorNames = new Map((vendors || []).map((v: any) => [v.id, v.name]));

        const platformFee = Number(process.env.PLATFORM_FEE_PERCENTAGE || 12) / 100;

        const rows = (orders || []).map((o: any) => {
            const total = Number(o.total) || 0;
            const serviceFee = Number(o.service_fee) || 0;
            const pFee = Math.round(total * platformFee * 100) / 100;
            return {
                order_id: o.id,
                vendor: vendorNames.get(o.vendor_id) || o.vendor_id,
                total: total.toFixed(2),
                service_fee: serviceFee.toFixed(2),
                platform_fee: pFee.toFixed(2),
                net_to_vendor: (total - serviceFee - pFee).toFixed(2),
                payment_method: o.payment_method,
                status: o.status,
                refund: o.refund_status !== 'none' ? `${o.refund_status} R${o.refund_amount}` : '',
                date: o.created_at,
            };
        });

        void emailCSVExport({
            to: email,
            subject: `Reconciliation Report — ${startDate} to ${endDate}`,
            filename: `reconciliation-${startDate}-${endDate}.csv`,
            rows,
            columns: [
                { key: 'order_id', label: 'Order ID' },
                { key: 'vendor', label: 'Vendor' },
                { key: 'total', label: 'Total (R)' },
                { key: 'service_fee', label: 'Service Fee (R)' },
                { key: 'platform_fee', label: 'Platform Fee (R)' },
                { key: 'net_to_vendor', label: 'Net to Vendor (R)' },
                { key: 'payment_method', label: 'Payment Method' },
                { key: 'status', label: 'Order Status' },
                { key: 'refund', label: 'Refund' },
                { key: 'date', label: 'Date' },
            ],
        }).catch(err => console.error('Failed to email reconciliation:', err?.message || err));

        return { message: 'Export started. You\'ll receive an email shortly.' };
    });

    // ── Admin: Export settlement payouts ──────────────────────────────────
    fastify.post('/admin/payouts', { preHandler: [authenticateAdmin] }, async (request, reply) => {
        const { email } = request.user as { email: string };
        const { batchId, vendorId } = request.body as { batchId?: string; vendorId?: string };

        let query = supabase
            .from('settlement_payouts')
            .select('id, batch_id, vendor_id, vendor_name, gross_amount, service_fee_total, platform_fee_total, payout_fee, vendor_amount, order_count, status, payment_reference, created_at')
            .order('created_at', { ascending: false })
            .limit(10000);

        if (batchId) query = query.eq('batch_id', batchId);
        if (vendorId) query = query.eq('vendor_id', vendorId);

        const { data: payouts, error } = await query;
        if (error) throw new Error(`Export failed: ${error.message}`);

        const rows = (payouts || []).map((p: any) => ({
            payout_id: p.id,
            batch_id: p.batch_id,
            vendor: p.vendor_name || p.vendor_id,
            gross: Number(p.gross_amount || 0).toFixed(2),
            service_fees: Number(p.service_fee_total || 0).toFixed(2),
            platform_fees: Number(p.platform_fee_total || 0).toFixed(2),
            payout_fee: Number(p.payout_fee || 0).toFixed(2),
            net_amount: Number(p.vendor_amount || 0).toFixed(2),
            orders: p.order_count,
            status: p.status,
            reference: p.payment_reference || '',
            date: p.created_at,
        }));

        void emailCSVExport({
            to: email,
            subject: 'Settlement Payouts Export',
            filename: `payouts-${new Date().toISOString().split('T')[0]}.csv`,
            rows,
            columns: [
                { key: 'payout_id', label: 'Payout ID' },
                { key: 'batch_id', label: 'Batch ID' },
                { key: 'vendor', label: 'Vendor' },
                { key: 'gross', label: 'Gross (R)' },
                { key: 'service_fees', label: 'Service Fees (R)' },
                { key: 'platform_fees', label: 'Platform Fees (R)' },
                { key: 'payout_fee', label: 'Payout Fee (R)' },
                { key: 'net_amount', label: 'Net Amount (R)' },
                { key: 'orders', label: 'Orders' },
                { key: 'status', label: 'Status' },
                { key: 'reference', label: 'Payment Reference' },
                { key: 'date', label: 'Date' },
            ],
        }).catch(err => console.error('Failed to email payouts export:', err?.message || err));

        return { message: 'Export started. You\'ll receive an email shortly.' };
    });

    // ── Vendor: Export my payouts ─────────────────────────────────────────
    fastify.post('/vendor/payouts', { preHandler: [authenticate] }, async (request, reply) => {
        const { vendorId, email } = request.user as { vendorId: string; email: string };

        const { data: payouts, error } = await supabase
            .from('settlement_payouts')
            .select('id, batch_id, gross_amount, service_fee_total, platform_fee_total, payout_fee, vendor_amount, order_count, status, payment_reference, created_at')
            .eq('vendor_id', vendorId)
            .order('created_at', { ascending: false })
            .limit(5000);

        if (error) throw new Error(`Export failed: ${error.message}`);

        const rows = (payouts || []).map((p: any) => ({
            date: p.created_at,
            gross: Number(p.gross_amount || 0).toFixed(2),
            fees: Number((p.service_fee_total || 0) + (p.platform_fee_total || 0) + (p.payout_fee || 0)).toFixed(2),
            net: Number(p.vendor_amount || 0).toFixed(2),
            orders: p.order_count,
            status: p.status,
            reference: p.payment_reference || '',
        }));

        void emailCSVExport({
            to: email,
            subject: 'Your Payout History',
            filename: `my-payouts-${new Date().toISOString().split('T')[0]}.csv`,
            rows,
            columns: [
                { key: 'date', label: 'Date' },
                { key: 'gross', label: 'Gross Sales (R)' },
                { key: 'fees', label: 'Total Fees (R)' },
                { key: 'net', label: 'Net Payout (R)' },
                { key: 'orders', label: 'Orders' },
                { key: 'status', label: 'Status' },
                { key: 'reference', label: 'Payment Reference' },
            ],
        }).catch(err => console.error('Failed to email vendor payouts:', err?.message || err));

        return { message: 'Export started. You\'ll receive an email shortly.' };
    });
};

export default exportController;
