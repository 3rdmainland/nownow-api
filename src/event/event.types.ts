export type EventStatus = 'ACTIVE' | 'CANCELED';

export interface EventBranding {
    theme?: {
        primary?: string;
        secondary?: string;
        accent?: string;
        background?: string;
        foreground?: string;
        landingBackground?: string;
    };
    assets?: {
        logoLight?: string;
        logoDark?: string;
        favicon?: string;
        backgroundImage?: string;
    };
    copy?: {
        tagline?: string;
    };
}

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
    menuStatus?: 'DRAFT' | 'PUBLISHED' | 'NOT_CONFIGURED';
    branding?: EventBranding;
}
