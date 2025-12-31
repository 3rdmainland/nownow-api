import { supabase } from "../lib/supabase";
import { Order, OrderStatus } from "./order.types";
import { Event } from "../event/event.types";

export interface SchedulingValidation {
    isValid: boolean;
    error?: string;
    estimatedReadyTime?: string;
    queuePosition?: number;
    totalWaitTime?: number;
}

export class OrderScheduler {
    /**
     * Rounds a date up to the nearest 5-minute interval
     * e.g., 12:12 -> 12:15, 12:18 -> 12:20, 12:00 -> 12:00
     */
    private roundUpToNearest5Minutes(date: Date): Date {
        const ms = date.getTime();
        const fiveMinutesMs = 5 * 60 * 1000;
        const remainder = ms % fiveMinutesMs;

        if (remainder === 0) {
            return new Date(ms);
        }

        return new Date(ms + (fiveMinutesMs - remainder));
    }

    // Helper: format Date -> YYYY-MM-DD (UTC)
    private toYMD(date: Date): string {
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // Helper: enumerate days from start (inclusive) to end (exclusive) by UTC dates
    private enumerateEventDaysUTC(startISO: string, endISO: string): string[] {
        const start = new Date(startISO);
        const end = new Date(endISO);
        // Normalize to 00:00 UTC of each day
        const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
        const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
        const days: string[] = [];
        while (cursor <= endDay) {
            days.push(this.toYMD(cursor));
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        return days;
    }

    // Helper: combine YYYY-MM-DD and HH:MM as a UTC Date
    private toUTCDate(dateYMD: string, timeHM: string): Date {
        // Expect time like HH:MM
        const t = /^(\d{2}):(\d{2})$/.exec(timeHM || '00:00');
        const [h, m] = t ? [parseInt(t[1], 10), parseInt(t[2], 10)] : [0, 0];
        const [y, mo, d] = dateYMD.split('-').map(v => parseInt(v, 10));
        return new Date(Date.UTC(y, mo - 1, d, h, m, 0, 0));
    }

    // Build effective allowed intervals based on event_day_hours with optional vendor_event_hours overrides
    private async buildAllowedIntervals(
        event: any,
        vendorId: string,
        now: Date
    ): Promise<Array<{ start: Date; end: Date }>> {
        const eventStart = new Date(event.start_date);
        const eventEnd = new Date(event.end_date);

        // Fetch hours; tolerate absence of tables
        let eventDayHours: Array<{ date: string; open_time: string; close_time: string; is_closed: boolean }> = [];
        let vendorEventHours: Array<{ date: string; open_time: string; close_time: string; is_closed: boolean }> = [];

        try {
            const { data } = await supabase
                .from('event_day_hours')
                .select('date,open_time,close_time,is_closed')
                .eq('event_id', event.id);
            eventDayHours = (data || []) as any;
        } catch (_) { /* ignore if table missing */ }

        try {
            const { data } = await supabase
                .from('vendor_event_hours')
                .select('date,open_time,close_time,is_closed')
                .eq('event_id', event.id)
                .eq('vendor_id', vendorId);
            vendorEventHours = (data || []) as any;
        } catch (_) { /* ignore if table missing */ }

        // If no config, fallback to a single full-window interval
        const hasAnyConfig = (eventDayHours && eventDayHours.length) || (vendorEventHours && vendorEventHours.length);
        if (!hasAnyConfig) {
            const start = this.roundUpToNearest5Minutes(eventStart > now ? eventStart : now);
            return start < eventEnd ? [{ start, end: eventEnd }] : [];
        }

        const byDate = new Map<string, { open_time: string; close_time: string; is_closed: boolean }>();
        for (const r of eventDayHours) byDate.set(r.date, { open_time: r.open_time, close_time: r.close_time, is_closed: r.is_closed });
        // override with vendor-specific
        for (const r of vendorEventHours) byDate.set(r.date, { open_time: r.open_time, close_time: r.close_time, is_closed: r.is_closed });

        const days = this.enumerateEventDaysUTC(event.start_date, event.end_date);
        const intervals: Array<{ start: Date; end: Date }> = [];

        for (const day of days) {
            const config = byDate.get(day);
            if (!config || config.is_closed) continue;
            const open = this.toUTCDate(day, config.open_time || '00:00');
            const close = this.toUTCDate(day, config.close_time || '23:59');

            // If close <= open, treat as overnight: split into [open, dayEnd] and [nextDayStart, nextClose]
            const dayEnd = new Date(Date.UTC(open.getUTCFullYear(), open.getUTCMonth(), open.getUTCDate(), 23, 59, 0, 0));
            const nextDay = new Date(Date.UTC(open.getUTCFullYear(), open.getUTCMonth(), open.getUTCDate() + 1));

            const pushClamped = (s: Date, e: Date) => {
                const start = new Date(Math.max(s.getTime(), now.getTime(), eventStart.getTime()));
                const end = new Date(Math.min(e.getTime(), eventEnd.getTime()));
                if (start < end) intervals.push({ start: this.roundUpToNearest5Minutes(start), end });
            };

            if (close <= open) {
                // segment 1: same day until 23:59
                pushClamped(open, dayEnd);
                // segment 2: next day from 00:00 to close
                const nextClose = new Date(Date.UTC(nextDay.getUTCFullYear(), nextDay.getUTCMonth(), nextDay.getUTCDate(), close.getUTCHours(), close.getUTCMinutes(), 0, 0));
                pushClamped(nextDay, nextClose);
            } else {
                pushClamped(open, close);
            }
        }

        // Sort intervals by start
        intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
        return intervals;
    }
    /**
     * Validates if a scheduled pickup time is within event period and feasible
     */
    async validateScheduledOrder(
        vendorId: string,
        eventId: string,
        requestedPickupTime: string,
        estimatedPrepTime: number
    ): Promise<SchedulingValidation> {
        // 1. Fetch event details
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .single();

        if (eventError || !event) {
            return {
                isValid: false,
                error: 'Event not found'
            };
        }

        const eventStart = new Date(event.start_date);
        const eventEnd = new Date(event.end_date);
        const pickupTime = new Date(requestedPickupTime);
        const now = new Date();

        // 2. Validate event is active
        if (event.status !== 'ONGOING' && event.status !== 'APPROVED') {
            return {
                isValid: false,
                error: 'Event is not active'
            };
        }

        // 3. Validate pickup time is within event period
        if (pickupTime < eventStart || pickupTime > eventEnd) {
            return {
                isValid: false,
                error: `Pickup time must be between ${eventStart.toISOString()} and ${eventEnd.toISOString()}`
            };
        }

        // 4. Validate pickup time is in the future (at least prep time away)
        const minPickupTime = new Date(now.getTime() + estimatedPrepTime * 60000);
        if (pickupTime < minPickupTime) {
            return {
                isValid: false,
                error: `Pickup time must be at least ${estimatedPrepTime} minutes from now`
            };
        }

        // 5. Calculate queue and waiting time
        const queueData = await this.calculateQueuePosition(vendorId, requestedPickupTime);

        // 6. Check if vendor can fulfill by requested time
        const canFulfill = await this.canVendorFulfillByTime(
            vendorId,
            requestedPickupTime,
            estimatedPrepTime,
            queueData
        );

        if (!canFulfill) {
            return {
                isValid: false,
                error: `Vendor cannot fulfill order by ${pickupTime.toISOString()}. Estimated ready time: ${queueData.estimatedReadyTime}`,
                estimatedReadyTime: queueData.estimatedReadyTime,
                queuePosition: queueData.position
            };
        }

        return {
            isValid: true,
            estimatedReadyTime: queueData.estimatedReadyTime,
            queuePosition: queueData.position,
            totalWaitTime: queueData.totalWaitTime
        };
    }

    /**
     * Calculates queue position and estimated ready time for a new order
     */
    private async calculateQueuePosition(
        vendorId: string,
        scheduledPickupTime: string
    ): Promise<{
        position: number;
        estimatedReadyTime: string;
        totalWaitTime: number;
    }> {
        const now = new Date();
        const pickupTime = new Date(scheduledPickupTime);

        // Get all pending and preparing orders for this vendor
        const { data: existingOrders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('vendor_id', vendorId)
            .in('status', [OrderStatus.PENDING, OrderStatus.PREPARING])
            .order('created_at', { ascending: true });

        if (error) {
            throw new Error(`Failed to fetch vendor orders: ${error.message}`);
        }

        const orders = (existingOrders || []) as Order[];

        // Filter orders that will be processed before the requested pickup time
        const ordersBeforePickup = orders.filter(order => {
            const orderPickupTime = order.scheduled_pickup_time
                ? new Date(order.scheduled_pickup_time)
                : new Date(order.created_at);
            return orderPickupTime <= pickupTime;
        });

        // Calculate total prep time for orders in queue
        const totalPrepTimeInQueue = ordersBeforePickup.reduce((sum, order) => {
            return sum + (order.estimatedPrepTime || 0);
        }, 0);

        // Calculate estimated ready time
        const estimatedReadyTime = new Date(now.getTime() + totalPrepTimeInQueue * 60000);

        return {
            position: ordersBeforePickup.length + 1,
            estimatedReadyTime: estimatedReadyTime.toISOString(),
            totalWaitTime: totalPrepTimeInQueue
        };
    }

    /**
     * Checks if vendor can fulfill order by requested time
     */
    private async canVendorFulfillByTime(
        vendorId: string,
        requestedPickupTime: string,
        estimatedPrepTime: number,
        queueData: { position: number; estimatedReadyTime: string; totalWaitTime: number }
    ): Promise<boolean> {
        const requestedTime = new Date(requestedPickupTime);
        const estimatedReady = new Date(queueData.estimatedReadyTime);

        // Add buffer time (5 minutes) for preparation
        const bufferTime = 0;
        const requiredReadyTime = new Date(estimatedReady.getTime() + estimatedPrepTime * 60000 + bufferTime);

        return requiredReadyTime <= requestedTime;
    }

    /**
     * Gets available time slots for a vendor within an event period
     */
    // order.scheduler.ts
    async getAvailableTimeSlots(
        vendorId: string,
        eventId: string,
        slotDurationMinutes = 30
    ): Promise<{
        slots: Array<{
            startTime: string;
            endTime: string;
            available: boolean;
            queueLength: number;
        }>;
    }> {
        // 1) Load the event
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .single();
        if (eventError || !event) throw new Error('Event not found');

        const eventStart = new Date(event.start_date);
        const eventEnd = new Date(event.end_date);
        const now = new Date();

        // Build allowed intervals using per-day hours
        const intervals = await this.buildAllowedIntervals(event, vendorId, now);
        const firstStart = intervals[0]?.start || this.roundUpToNearest5Minutes(eventStart > now ? eventStart : now);

        // 2) Fetch all orders for the vendor within the window in ONE query
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('scheduled_pickup_time,status')
            .eq('vendor_id', vendorId)
            .gte('scheduled_pickup_time', firstStart.toISOString())
            .lt('scheduled_pickup_time', eventEnd.toISOString())
            .in('status', [OrderStatus.PENDING, OrderStatus.PREPARING]);
        if (ordersError) throw new Error(ordersError.message);

        const pending = (orders || []).map(o => new Date(o.scheduled_pickup_time));

        // 3) Build slots within allowed intervals and count in memory
        const slots = [] as Array<{ startTime: string; endTime: string; available: boolean; queueLength: number; }>;
        const effectiveIntervals = intervals.length ? intervals : [{ start: firstStart, end: eventEnd }];

        for (const { start, end } of effectiveIntervals) {
            let cursor = new Date(start);
            while (cursor < end) {
                const slotEnd = new Date(cursor.getTime() + slotDurationMinutes * 60000);
                if (slotEnd > end) break;
                const count = pending.reduce((acc, t) => (t >= cursor && t < slotEnd ? acc + 1 : acc), 0);
                slots.push({
                    startTime: cursor.toISOString(),
                    endTime: slotEnd.toISOString(),
                    available: count < 5,
                    queueLength: count,
                });
                cursor = slotEnd;
            }
        }

        return { slots };
    }

    /**
     * Calculates actual prep time when order is marked ready
     */
    calculateActualPrepTime(preparedAt: string, readyAt: string): number {
        const prepared = new Date(preparedAt);
        const ready = new Date(readyAt);
        return Math.round((ready.getTime() - prepared.getTime()) / 60000);
    }

    /**
     * Updates queue positions for pending orders after an order status change
     */
    async updateQueuePositions(vendorId: string): Promise<void> {
        const { data: pendingOrders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('vendor_id', vendorId)
            .eq('status', OrderStatus.PENDING)
            .order('scheduled_pickup_time', { ascending: true });

        if (error) {
            console.error('Failed to update queue positions:', error.message);
            return;
        }

        const orders = (pendingOrders || []) as Order[];

        // Update queue positions
        for (let i = 0; i < orders.length; i++) {
            await supabase
                .from('orders')
                .update({ queue_position: i + 1 })
                .eq('id', orders[i].id);
        }
    }

    /**
     * Validates if immediate order can be placed (no scheduling)
     */
    async validateImmediateOrder(
        vendorId: string,
        eventId: string,
        estimatedPrepTime: number
    ): Promise<SchedulingValidation> {
        const now = new Date();
        const estimatedReadyTime = new Date(now.getTime() + estimatedPrepTime * 60000);

        // Fetch event to ensure it's active
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .single();

        if (eventError || !event) {
            return {
                isValid: false,
                error: 'Event not found'
            };
        }

        const eventEnd = new Date(event.end_date);

        // Check if order can be ready before event ends
        if (estimatedReadyTime > eventEnd) {
            return {
                isValid: false,
                error: 'Order cannot be completed before event ends'
            };
        }

        // Get queue info
        const queueData = await this.calculateQueuePosition(
            vendorId,
            estimatedReadyTime.toISOString()
        );

        return {
            isValid: true,
            estimatedReadyTime: queueData.estimatedReadyTime,
            queuePosition: queueData.position,
            totalWaitTime: queueData.totalWaitTime
        };
    }
}
