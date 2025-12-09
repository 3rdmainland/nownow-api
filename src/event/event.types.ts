export type EventStatus = 'PENDING' | 'APPROVED' | 'ONGOING' | 'REJECTED';

export interface Event {
    id: string;
    name: string;
    description?: string;
    startDate: string;
    endDate: string;
    location: {
        latitude: number;
        longitude: number;
        address: string;
        city: string;
        state: string;
        zipCode: string;
    };
    imageUrl?: string;
    isPublic: boolean;
    status: EventStatus;
    created_at: string;
    updated_at?: string;
    vendorIds: string[];
    code: string;
}
