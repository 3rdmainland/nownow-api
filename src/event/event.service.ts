import { supabase } from "../lib/supabase";
import { Event } from "./event.types";
import {OrderStatus} from "../orders/order.types";
import {fromDbEvent, toDbEvent} from "./util";
import { cache } from "../lib/redis";

const EVENT_CACHE_TTL = 60; // 60 seconds

const eventCacheKeys = {
    all: () => 'events:all',
    byId: (id: string) => `events:id:${id}`,
    byCode: (code: string) => `events:code:${code}`,
} as const;

export class EventService {

    async getAllEvents(): Promise<Event[]> {
        const cacheKey = eventCacheKeys.all();
        const cached = await cache.get<Event[]>(cacheKey);
        if (cached) return cached;

        const { data, error } = await supabase
            .from("events")
            .select("*");

        if (error) {
            throw new Error(`Failed to fetch events: ${error.message}`);
        }

        const events = (data || []).map(dbEvent => fromDbEvent(dbEvent));
        await this.populateVendorIds(events);
        await cache.set(cacheKey, events, EVENT_CACHE_TTL);
        return events;
    }

    async getEventById(id: string): Promise<Event | null> {
        const cacheKey = eventCacheKeys.byId(id);
        const cached = await cache.get<Event>(cacheKey);
        if (cached) return cached;

        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq("id", id)
            .single();

        if (error) {
            throw new Error(`Failed to fetch event: ${error.message}`);
        }

        const event = data ? fromDbEvent(data) : null;
        if (event) {
            await this.populateVendorIds([event]);
            await cache.set(cacheKey, event, EVENT_CACHE_TTL);
        }
        return event;
    }

    async getEventByCode(code: string): Promise<Event | null> {
        const cacheKey = eventCacheKeys.byCode(code);
        const cached = await cache.get<Event>(cacheKey);
        if (cached) return cached;

        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('code', code)
            .single();

        if (error) return null;
        const event = data ? fromDbEvent(data) : null;
        if (event) {
            await this.populateVendorIds([event]);
            await cache.set(cacheKey, event, EVENT_CACHE_TTL);
        }
        return event;
    }

    // Add a helper method to get event by ID or code
    async getEventByIdOrCode(eventIdOrCode: string): Promise<string | null> {
        // First try as UUID (ID)
        const { data: eventById, error: idError } = await supabase
            .from('events')
            .select('id')
            .eq('id', eventIdOrCode)
            .single();

        if (!idError && eventById) {
            return eventById.id;
        }

        // If not found by ID, try by code
        const { data: eventByCode, error: codeError } = await supabase
            .from('events')
            .select('id')
            .eq('code', eventIdOrCode)
            .single();

        if (!codeError && eventByCode) {
            return eventByCode.id;
        }

        return null;
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

    async addVendorsToEvent(eventId: string, vendorIds: string[]): Promise<void> {
        const rows = vendorIds.map(vendorId => ({ event_id: eventId, vendor_id: vendorId }));
        const { error } = await supabase
            .from("event_vendors")
            .upsert(rows, { onConflict: "event_id,vendor_id" });
        if (error) throw new Error(`Failed to add vendors to event: ${error.message}`);
        await this.invalidateEventVendorCache(eventId);
        await this.invalidateEventCachesById(eventId);
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
            .in('event_id', eventIds);

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

    async getEventsByVendorId(vendorId: string, activeOnly = false): Promise<Event[]> {
        let query = supabase
            .from("event_vendors")
            .select(`events!inner(*)`)
            .eq("vendor_id", vendorId);

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
