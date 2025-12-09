import { supabase } from "../../supabase";
import { Event } from "./event.types";
import {OrderStatus} from "../orders/order.types";
import {fromDbEvent, toDbEvent} from "./util";

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
}
