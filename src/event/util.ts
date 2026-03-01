// event.utils.ts
import {Event} from "./event.types";

export function toDbEvent(event: Partial<Event>) {
    return {
        name: event.name,
        description: event.description,
        start_date: event.startDate,
        end_date: event.endDate,
        location: event.location,
        image_url: event.imageUrl,
        is_public: event.isPublic,
        code: event.code,
        status: event.status,
        branding: event.branding ?? undefined,
    };
}

export function fromDbEvent(dbEvent: any): Event {
    return {
        id: dbEvent.id,
        name: dbEvent.name,
        description: dbEvent.description,
        startDate: dbEvent.start_date,
        endDate: dbEvent.end_date,
        location: dbEvent.location,
        imageUrl: dbEvent.image_url,
        isPublic: dbEvent.is_public,
        status: dbEvent.status,
        code: dbEvent.code,
        created_at: dbEvent.created_at,
        updated_at: dbEvent.updated_at,
        vendorIds: [],
        branding: dbEvent.branding ?? undefined,
    };
}
