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

    // Build effective slots allowed intervals based on event_day_hours, vendor_event_hours, and vendor's own operating hours
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
        let vendorHours: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }> = [];

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

        // Fetch vendor's own operating hours (day-of-week based)
        try {
            const { data: vendor } = await supabase
                .from('vendors')
                .select('hours')
                .eq('id', vendorId)
                .single();
            if (vendor?.hours && Array.isArray(vendor.hours)) {
                vendorHours = vendor.hours;
            }
        } catch (_) { /* ignore if not found */ }

        // Build vendor hours lookup by day of week (0=Sunday, 6=Saturday)
        // Handle both camelCase (from app) and snake_case (from DB) formats
        const vendorHoursByDayOfWeek = new Map<number, { openTime: string; closeTime: string; isClosed: boolean }>();
        for (const h of vendorHours) {
            const dayOfWeek = h.dayOfWeek ?? (h as any).day_of_week;
            const openTime = h.openTime ?? (h as any).open_time;
            const closeTime = h.closeTime ?? (h as any).close_time;
            const isClosed = h.isClosed ?? (h as any).is_closed;
            if (dayOfWeek !== undefined) {
                vendorHoursByDayOfWeek.set(dayOfWeek, { openTime, closeTime, isClosed });
            }
        }

        // If no event config but vendor has hours, use vendor hours
        // If no config at all, fallback to a single full-window interval
        const hasEventConfig = (eventDayHours && eventDayHours.length) || (vendorEventHours && vendorEventHours.length);
        const hasVendorHours = vendorHours.length > 0;

        if (!hasEventConfig && !hasVendorHours) {
            const start = this.roundUpToNearest5Minutes(eventStart > now ? eventStart : now);
            return start < eventEnd ? [{ start, end: eventEnd }] : [];
        }

        const byDate = new Map<string, { open_time: string; close_time: string; is_closed: boolean }>();
        for (const r of eventDayHours) byDate.set(r.date, { open_time: r.open_time, close_time: r.close_time, is_closed: r.is_closed });
        // override with vendor-specific event hours
        for (const r of vendorEventHours) byDate.set(r.date, { open_time: r.open_time, close_time: r.close_time, is_closed: r.is_closed });

        const days = this.enumerateEventDaysUTC(event.start_date, event.end_date);
        const intervals: Array<{ start: Date; end: Date }> = [];

        for (const day of days) {
            const dateObj = new Date(day + 'T00:00:00Z');
            const dayOfWeek = dateObj.getUTCDay(); // 0=Sunday, 6=Saturday

            // Check vendor's day-of-week operating hours
            const vendorDayHours = vendorHoursByDayOfWeek.get(dayOfWeek);
            if (vendorDayHours?.isClosed) continue; // Vendor closed on this day of week

            const eventConfig = byDate.get(day);

            // Determine the effective hours for this day
            let effectiveOpen: string;
            let effectiveClose: string;

            // Determine effective hours based on available config
            // Priority: vendor_event_hours > event_day_hours > vendor.hours > default event window
            if (eventConfig) {
                if (eventConfig.is_closed) continue;
                effectiveOpen = eventConfig.open_time || '00:00';
                effectiveClose = eventConfig.close_time || '23:59';

                // If vendor has hours for this day of week, intersect with event hours
                if (vendorDayHours && !vendorDayHours.isClosed) {
                    const vendorOpen = vendorDayHours.openTime || '00:00';
                    const vendorClose = vendorDayHours.closeTime || '23:59';
                    // Use the later opening time and earlier closing time
                    effectiveOpen = vendorOpen > effectiveOpen ? vendorOpen : effectiveOpen;
                    effectiveClose = vendorClose < effectiveClose ? vendorClose : effectiveClose;
                }
            } else if (vendorDayHours && !vendorDayHours.isClosed) {
                // No event config for this day, but vendor has hours for this day of week
                effectiveOpen = vendorDayHours.openTime || '00:00';
                effectiveClose = vendorDayHours.closeTime || '23:59';
            } else if (hasEventConfig && !hasVendorHours) {
                // Event has config for other days but not this one, and no vendor hours at all - skip
                continue;
            } else {
                // No event config for this day, vendor hours don't specify this day of week
                // Use default full day (event window will be applied in pushClamped)
                effectiveOpen = '00:00';
                effectiveClose = '23:59';
            }

            // Treat equal open/close (e.g. 00:00–00:00) as "open all day"
            if (effectiveOpen === effectiveClose) {
                effectiveOpen = '00:00';
                effectiveClose = '23:59';
            }

            const open = this.toUTCDate(day, effectiveOpen);
            const close = this.toUTCDate(day, effectiveClose);

            // Skip if close is before or equal to open (invalid interval after intersection)
            if (close <= open) continue;

            const pushClamped = (s: Date, e: Date) => {
                const start = new Date(Math.max(s.getTime(), now.getTime(), eventStart.getTime()));
                const end = new Date(Math.min(e.getTime(), eventEnd.getTime()));
                if (start < end) intervals.push({ start: this.roundUpToNearest5Minutes(start), end });
            };

            pushClamped(open, close);
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
        if (event.status !== 'ACTIVE') {
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

        // 4b. Validate pickup time falls within vendor operating hours
        const intervals = await this.buildAllowedIntervals(event, vendorId, now);
        const withinOperatingHours = intervals.some(
            ({ start, end }) => pickupTime >= start && pickupTime < end
        );
        if (!withinOperatingHours) {
            return {
                isValid: false,
                error: 'Pickup time is outside vendor operating hours'
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
            .select('id, scheduled_pickup_time, created_at, estimated_prep_time')
            .eq('vendor_id', vendorId)
            .in('status', [OrderStatus.PENDING, OrderStatus.PREPARING])
            .order('created_at', { ascending: true });

        if (error) {
            throw new Error(`Failed to fetch vendor orders: ${error.message}`);
        }

        const orders = (existingOrders || []) as Pick<Order, 'id' | 'scheduled_pickup_time' | 'created_at' | 'estimated_prep_time'>[];

        // Filter orders that will be processed before the requested pickup time
        const ordersBeforePickup = orders.filter(order => {
            const orderPickupTime = order.scheduled_pickup_time
                ? new Date(order.scheduled_pickup_time)
                : new Date(order.created_at);
            return orderPickupTime <= pickupTime;
        });

        // Calculate total prep time for orders in queue
        const totalPrepTimeInQueue = ordersBeforePickup.reduce((sum, order) => {
            return sum + (order.estimated_prep_time || 0);
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

        // Fetch vendor prep time and menu config for buffer + slot duration
        const { data: vendor } = await supabase
            .from('vendors')
            .select('estimated_prep_time')
            .eq('id', vendorId)
            .single();

        const { data: menuConfig } = await supabase
            .from('event_menu_configurations')
            .select('prep_time_buffer_minutes, slot_duration_minutes')
            .eq('vendor_id', vendorId)
            .eq('event_id', eventId)
            .single();

        const prepTimeMinutes = (vendor?.estimated_prep_time || 12) + (menuConfig?.prep_time_buffer_minutes ?? 0);

        // Use config slot duration as default, but allow query param to override
        if (slotDurationMinutes === 30 && menuConfig?.slot_duration_minutes) {
            slotDurationMinutes = menuConfig.slot_duration_minutes;
        }

        // Earliest possible pickup = now + prep time
        const earliest = new Date(now.getTime() + prepTimeMinutes * 60000);

        // Calculate end of tomorrow (limit slots to today and tomorrow only)
        const endOfTomorrow = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 2, // Day after tomorrow at 00:00 UTC
            0, 0, 0, 0
        ));
        // Use the earlier of event end or end of tomorrow as the cutoff
        const slotsCutoff = eventEnd < endOfTomorrow ? eventEnd : endOfTomorrow;

        // Build allowed intervals using per-day hours, offset by prep time
        const intervals = await this.buildAllowedIntervals(event, vendorId, earliest);
        const firstStart = intervals[0]?.start || this.roundUpToNearest5Minutes(eventStart > earliest ? eventStart : earliest);

        // 2) Fetch all orders for the vendor within the window in ONE query
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('scheduled_pickup_time,status')
            .eq('vendor_id', vendorId)
            .gte('scheduled_pickup_time', firstStart.toISOString())
            .lt('scheduled_pickup_time', slotsCutoff.toISOString())
            .in('status', [OrderStatus.PENDING, OrderStatus.PREPARING]);
        if (ordersError) throw new Error(ordersError.message);

        const pending = (orders || []).map(o => new Date(o.scheduled_pickup_time));

        // 3) Build slots within allowed intervals and count in memory (limited to today and tomorrow)
        const slots = [] as Array<{ startTime: string; endTime: string; available: boolean; queueLength: number; }>;
        const effectiveIntervals = intervals.length ? intervals : [{ start: firstStart, end: eventEnd }];

        for (const { start, end } of effectiveIntervals) {
            // Skip intervals that start after our cutoff
            if (start >= slotsCutoff) continue;
            // Clamp the interval end to our cutoff
            const clampedEnd = end > slotsCutoff ? slotsCutoff : end;
            let cursor = new Date(start);
            while (cursor < clampedEnd) {
                const slotEnd = new Date(cursor.getTime() + slotDurationMinutes * 60000);
                if (slotEnd > clampedEnd) break;
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
     * Updates queue positions for pending orders after an order status change.
     * Uses a single RPC call instead of N individual UPDATEs.
     */
    async updateQueuePositions(vendorId: string): Promise<void> {
        const { error } = await supabase.rpc('batch_update_queue_positions', {
            p_vendor_id: vendorId,
        });

        if (error) {
            console.error('Failed to batch-update queue positions:', error.message);
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
