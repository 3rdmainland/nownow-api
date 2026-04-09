import { supabase, safeQuery } from "../lib/supabase";
import { Event } from "./event.types";
import {OrderStatus} from "../orders/order.types";
import {fromDbEvent, toDbEvent} from "./util";
import { cache } from "../lib/redis";
import { ValidationError } from "../lib/errors";

const EVENT_CACHE_TTL = 60; // 60 seconds

const eventCacheKeys = {
    all: () => 'events:all',
    byId: (id: string) => `events:id:${id}`,
    byCode: (code: string) => `events:code:${code}`,
} as const;

export class EventService {

    async getAllEvents(): Promise<Event[]> {
        const cacheKey = eventCacheKeys.all();
        return cache.getOrFetch<Event[]>(cacheKey, async () => {
            const { data, error } = await supabase
                .from("events")
                .select("*")
                .order('created_at', { ascending: false })
                .limit(200);

            if (error) {
                throw new Error(`Failed to fetch events: ${error.message}`);
            }

            const events = (data || []).map(dbEvent => fromDbEvent(dbEvent));
            await this.populateVendorIds(events);
            return events;
        }, EVENT_CACHE_TTL);
    }

    async getEventById(id: string): Promise<Event | null> {
        const cacheKey = eventCacheKeys.byId(id);
        return cache.getOrFetch<Event | null>(cacheKey, async () => {
            const { data, error } = await safeQuery(() => Promise.resolve(
                supabase.from('events').select('*').eq("id", id).single()
            ));

            if (error) {
                throw new Error(`Failed to fetch event: ${error.message}`);
            }

            const event = data ? fromDbEvent(data) : null;
            if (event) {
                await this.populateVendorIds([event]);
            }
            return event;
        }, EVENT_CACHE_TTL);
    }

    async getEventByCode(code: string): Promise<Event | null> {
        const cacheKey = eventCacheKeys.byCode(code);
        return cache.getOrFetch<Event | null>(cacheKey, async () => {
            const { data, error } = await supabase
                .from('events')
                .select('*')
                .eq('code', code)
                .single();

            if (error) return null;
            const event = data ? fromDbEvent(data) : null;
            if (event) {
                await this.populateVendorIds([event]);
            }
            return event;
        }, EVENT_CACHE_TTL);
    }

    async getEventByIdOrCode(eventIdOrCode: string): Promise<string | null> {
        return cache.getOrFetch(`event:resolve:${eventIdOrCode}`, async () => {
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventIdOrCode);

            if (isUuid) {
                const { data, error } = await safeQuery(() => Promise.resolve(
                    supabase.from('events').select('id').eq('id', eventIdOrCode).single()
                ));
                return (!error && data) ? data.id : null;
            }

            const { data, error } = await safeQuery(() => Promise.resolve(
                supabase.from('events').select('id').eq('code', eventIdOrCode).single()
            ));
            return (!error && data) ? data.id : null;
        }, 300);
    }

    async createEvent(event: Omit<Event, "id" | "created_at" | "status">): Promise<Event> {
        const { status: _ignored, ...safeDbEvent } = toDbEvent(event as Partial<Event>);
        const dbEvent = {
            ...safeDbEvent,
            status: 'ACTIVE' as const
        };

        const { data, error } = await supabase
            .from("events")
            .insert([dbEvent])
            .select()
            .single();

        if (error) throw new Error(`Failed to create event: ${error.message}`);

        const created = fromDbEvent(data);
        await this.invalidateEventCaches(created.id, created.code);
        return created;
    }

    async updateEvent(id: string, updates: Partial<Event>): Promise<Event> {
        const dbUpdates = Object.fromEntries(
            Object.entries(toDbEvent(updates)).filter(([, v]) => v !== undefined)
        );
        const { data, error } = await supabase.from("events").update(dbUpdates).eq("id", id).select().single();
        if (error) throw new Error(`Failed to update event: ${error.message}`);

        const event = fromDbEvent(data);
        await this.invalidateEventCaches(event.id, event.code);
        return event;
    }

    async deleteEvent(id: string): Promise<void> {
        // Fetch before deleting so we can invalidate by code too
        const existing = await this.getEventById(id);
        const { error } = await supabase.from("events").delete().eq("id", id);
        if (error) throw new Error(`Failed to delete event: ${error.message}`);
        await this.invalidateEventCaches(id, existing?.code);
    }

    private async invalidateEventCaches(id: string, code?: string): Promise<void> {
        const keys = [eventCacheKeys.all(), eventCacheKeys.byId(id)];
        if (code) keys.push(eventCacheKeys.byCode(code));
        try {
            await cache.del(...keys);
        } catch {
            // Cache invalidation failure should not break the operation
        }
    }

    async inviteVendorsToEvent(
        eventId: string,
        organizerId: string,
        invites: { vendorId: string; commissionRate: number }[]
    ): Promise<void> {
        // Fetch event to get organizer_id and start_date
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('id, organizer_id, start_date')
            .eq('id', eventId)
            .single();

        if (eventError || !event) throw new Error('Event not found');
        if (event.organizer_id !== organizerId) throw new Error('You do not own this event');

        // Validate commission rates
        for (const invite of invites) {
            if (invite.commissionRate < 0 || invite.commissionRate > 50) {
                throw new ValidationError(`Commission rate must be between 0% and 50%`);
            }
        }

        // Upsert event_vendors rows with status='invited'
        // If already accepted, skip (don't downgrade)
        const vendorRows = invites.map(inv => ({
            event_id: eventId,
            vendor_id: inv.vendorId,
            status: 'invited',
        }));

        const { error: upsertError } = await supabase
            .from('event_vendors')
            .upsert(vendorRows, {
                onConflict: 'event_id,vendor_id',
                ignoreDuplicates: true, // skip if already exists (accepted)
            });
        if (upsertError) throw new Error(`Failed to invite vendors to event: ${upsertError.message}`);

        // Insert organizer_vendor_agreements with status='draft'
        const agreementRows = invites.map(inv => ({
            organizer_id: organizerId,
            vendor_id: inv.vendorId,
            event_id: eventId,
            commission_rate: inv.commissionRate,
            status: 'draft',
            effective_from: event.start_date,
        }));

        const { error: agreementError } = await supabase
            .from('organizer_vendor_agreements')
            .upsert(agreementRows, {
                onConflict: 'organizer_id,vendor_id,event_id',
                ignoreDuplicates: true, // skip if agreement already exists
            });
        if (agreementError) throw new Error(`Failed to create invite agreements: ${agreementError.message}`);

        await this.invalidateEventVendorCache(eventId);
        await this.invalidateEventCachesById(eventId);
    }

    async getEventVendorStatuses(eventId: string): Promise<{ vendorId: string; status: string; createdAt: string }[]> {
        const { data, error } = await supabase
            .from('event_vendors')
            .select('vendor_id, status, created_at')
            .eq('event_id', eventId);

        if (error) throw new Error(`Failed to fetch vendor statuses: ${error.message}`);

        return (data || []).map(row => ({
            vendorId: row.vendor_id,
            status: row.status,
            createdAt: row.created_at,
        }));
    }

    async removeVendorFromEvent(eventId: string, vendorId: string): Promise<void> {
        const { error } = await supabase
            .from("event_vendors")
            .delete()
            .eq("event_id", eventId)
            .eq("vendor_id", vendorId);
        if (error) throw new Error(`Failed to remove vendor from event: ${error.message}`);

        // Expire any draft or active agreements for this vendor-event pair
        await supabase
            .from('organizer_vendor_agreements')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('event_id', eventId)
            .eq('vendor_id', vendorId)
            .in('status', ['draft', 'active']);

        await this.invalidateEventVendorCache(eventId);
        await this.invalidateEventCachesById(eventId);
    }

    /**
     * Fetches vendor IDs from event_vendors junction table and populates the vendorIds field on each event.
     */
    private async populateVendorIds(events: Event[]): Promise<void> {
        if (events.length === 0) return;

        const eventIds = events.map(e => e.id);
        const { data, error } = await supabase
            .from('event_vendors')
            .select('event_id, vendor_id')
            .in('event_id', eventIds)
            .eq('status', 'accepted');

        if (error || !data || !Array.isArray(data)) return;

        const vendorMap = new Map<string, string[]>();
        for (const row of data) {
            const existing = vendorMap.get(row.event_id) || [];
            existing.push(row.vendor_id);
            vendorMap.set(row.event_id, existing);
        }

        for (const event of events) {
            event.vendorIds = vendorMap.get(event.id) || [];
        }
    }

    /**
     * Invalidates event caches by event ID (used when vendor associations change).
     */
    private async invalidateEventCachesById(eventId: string): Promise<void> {
        // Fetch the event to get the code for cache invalidation
        const { data } = await supabase
            .from('events')
            .select('code')
            .eq('id', eventId)
            .single();

        await this.invalidateEventCaches(eventId, data?.code);
    }

    // Upstash doesn't support SCAN so we delete the most common paginated keys
    private async invalidateEventVendorCache(eventId: string): Promise<void> {
        const commonSizes = [10, 20, 50];
        const pages = [1, 2, 3];
        const keys = pages.flatMap(page =>
            commonSizes.map(size => `vendors:event:${eventId}:page:${page}:size:${size}`)
        );
        try {
            await cache.del(...keys);
        } catch {
            // Cache invalidation failure should not break the operation
        }
    }

    async getEventsByVendorId(vendorId: string, activeOnly = false, includeInvited = false): Promise<Event[]> {
        let query = supabase
            .from("event_vendors")
            .select(`events!inner(*)`)
            .eq("vendor_id", vendorId);

        if (includeInvited) {
            query = query.in('status', ['accepted', 'invited']);
        } else {
            query = query.eq('status', 'accepted');
        }

        if (activeOnly) {
            query = query.gte("events.end_date", new Date().toISOString());
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(`Failed to fetch events for vendor: ${error.message}`);
        }

        const events = (data || [])
            .map(item => item.events)
            .filter(event => event !== null)
            .map(dbEvent => fromDbEvent(dbEvent));

        if (events.length === 0) return events;

        // Fetch menu config statuses and template IDs for this vendor across all events
        const eventIds = events.map(e => e.id);
        const { data: configs } = await supabase
            .from("event_menu_configurations")
            .select("event_id, status, template_id")
            .eq("vendor_id", vendorId)
            .in("event_id", eventIds);

        const configMap = new Map<string, { status: string; templateId?: string }>(
            (configs || []).map(c => [c.event_id, { status: c.status, templateId: c.template_id }])
        );

        // Fetch template names for configs that reference a template
        const templateIds = [...new Set(
            (configs || []).map(c => c.template_id).filter(Boolean)
        )];

        let templateNameMap = new Map<string, string>();
        if (templateIds.length > 0) {
            const { data: templates } = await supabase
                .from("menu_templates")
                .select("id, name")
                .in("id", templateIds);
            templateNameMap = new Map(
                (templates || []).map(t => [t.id, t.name])
            );
        }

        return events.map(event => {
            const config = configMap.get(event.id);
            const menuStatus: Event['menuStatus'] = !config
                ? 'NOT_CONFIGURED'
                : config.status === 'PUBLISHED'
                    ? 'PUBLISHED'
                    : 'DRAFT';
            const menuTemplateName = config?.templateId
                ? templateNameMap.get(config.templateId)
                : undefined;
            return { ...event, menuStatus, menuTemplateName };
        });
    }
}
