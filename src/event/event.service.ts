import { supabase } from "../lib/supabase";
import { Event } from "./event.types";
import {OrderStatus} from "../orders/order.types";
import {fromDbEvent, toDbEvent} from "./util";
import { cache } from "../lib/redis";

export class EventService {
// In event.service.ts

    async getAllEvents(): Promise<Event[]> {
        const { data, error } = await supabase
            .from("events")
            .select("*");

        if (error) {
            throw new Error(`Failed to fetch events: ${error.message}`);
        }

        // Map each event from snake_case to camelCase
        return (data || []).map(dbEvent => fromDbEvent(dbEvent));
    }

    async getEventById(id: string): Promise<Event | null> {
        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq("id", id)
            .single();

        if (error) {
            throw new Error(`Failed to fetch event: ${error.message}`);
        }

        return data ? fromDbEvent(data) : null;
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
        const dbEvent = {
            ...toDbEvent(event),
            status: 'PENDING' as const
        };

        const { data, error } = await supabase
            .from("events")
            .insert([dbEvent])
            .select()
            .single();

        if (error) throw new Error(`Failed to create event: ${error.message}`);

        return fromDbEvent(data);
    }

    async updateEvent(id: string, updates: Partial<Event>): Promise<Event> {
        const { data, error } = await supabase.from("events").update(updates).eq("id", id).select().single();
        if (error) throw new Error(`Failed to update event: ${error.message}`);
        return data;
    }

    async deleteEvent(id: string): Promise<void> {
        const { error } = await supabase.from("events").delete().eq("id", id);
        if (error) throw new Error(`Failed to delete event: ${error.message}`);
    }

    async addVendorsToEvent(eventId: string, vendorIds: string[]): Promise<void> {
        const rows = vendorIds.map(vendorId => ({ event_id: eventId, vendor_id: vendorId }));
        const { error } = await supabase
            .from("event_vendors")
            .upsert(rows, { onConflict: "event_id,vendor_id" });
        if (error) throw new Error(`Failed to add vendors to event: ${error.message}`);
        await this.invalidateEventVendorCache(eventId);
    }

    async removeVendorFromEvent(eventId: string, vendorId: string): Promise<void> {
        const { error } = await supabase
            .from("event_vendors")
            .delete()
            .eq("event_id", eventId)
            .eq("vendor_id", vendorId);
        if (error) throw new Error(`Failed to remove vendor from event: ${error.message}`);
        await this.invalidateEventVendorCache(eventId);
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

    async getEventsByVendorId(vendorId: string): Promise<Event[]> {
        const { data, error } = await supabase
            .from("event_vendors")
            .select(`
                events (*)
            `)
            .eq("vendor_id", vendorId);

        if (error) {
            throw new Error(`Failed to fetch events for vendor: ${error.message}`);
        }

        return (data || [])
            .map(item => item.events)
            .filter(event => event !== null)
            .map(dbEvent => fromDbEvent(dbEvent));
    }
}
