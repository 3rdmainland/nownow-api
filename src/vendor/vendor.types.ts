// vendor.types.ts

export type MenuItemType = 'FOOD' | 'RETAIL';

export interface VendorHours {
    dayOfWeek: number; // 0-6 (Sunday-Saturday)
    openTime: string; // HH:MM format
    closeTime: string; // HH:MM format
    isClosed: boolean;
}

export interface VendorCategory {
    id: string;
    name: string;
}

export interface Vendor {
    id: string;
    name: string;
    description?: string;
    phone: string;
    email: string;
    imageUrl?: string;
    logoUrl?: string;
    categoryId?: string; // DEPRECATED: use categoryIds
    categoryIds: string[];
    categories?: VendorCategory[];
    cuisineType?: string[];
    rating?: number;
    totalReviews?: number;
    location?: any; // Optional flexible JSON - can be address, stall number, etc
    hours?: VendorHours[]; // Optional
    isActive: boolean;
    isPaused: boolean;
    minimumOrder?: number;
    deliveryFee?: number;
    serviceFeePercent?: number;
    estimatedPrepTime?: number;
    paymentMethods: string[];
    orderCount?: number;
    createdAt: string;
    updatedAt?: string;
}
