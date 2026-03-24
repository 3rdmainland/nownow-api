export type EventStatus = 'ACTIVE' | 'CANCELED';

export type EventType = 'festival' | 'concert' | 'party' | 'farmers_market' | 'food_festival' | 'corporate' | 'sports' | 'default';

export interface EventBranding {
    theme?: {
        primary?: string;
        secondary?: string;
        accent?: string;
        background?: string;
        foreground?: string;
        landingBackground?: string;
        landingTextColor?: 'light' | 'dark';
    };
    assets?: {
        logoLight?: string;
        logoDark?: string;
        favicon?: string;
        backgroundImage?: string;
        appBackgroundImage?: string;
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
    menuTemplateName?: string;
    branding?: EventBranding;
    eventType?: EventType;
}
