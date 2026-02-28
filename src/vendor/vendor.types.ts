// vendor.types.ts
// vendor.types.ts

export type MenuItemType = 'FOOD' | 'RETAIL';

export interface Tag {
    id: string;
    name: string;
    description?: string;
}

export interface VendorMenuItem {
    id: string;
    vendorId: string;
    categoryId: string;
    name: string;
    description?: string;
    price: number;
    imageUrl?: string;
    type: MenuItemType;
    prepTime?: number;
    available: boolean;
    tags?: Tag[]; // NEW
    createdAt: string;
    updatedAt?: string;
}

export interface VendorHours {
    dayOfWeek: number; // 0-6 (Sunday-Saturday)
    openTime: string; // HH:MM format
    closeTime: string; // HH:MM format
    isClosed: boolean;
}

export interface Vendor {
    id: string;
    name: string;
    description?: string;
    phone: string;
    email: string;
    imageUrl?: string;
    logoUrl?: string;
    categoryId: string;
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
    createdAt: string;
    updatedAt?: string;
}

export type VendorWithMenu = Vendor & { menu: VendorMenuItem[] };

export interface VendorMenuCategory {
    id: string;
    name: string;
}

export interface VendorMenuGroup {
    category: VendorMenuCategory;
    menuItems: VendorMenuItem[];
}
