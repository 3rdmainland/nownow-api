export type DiscountScope = 'EVENT' | 'ITEM';
export type DiscountType = 'PERCENTAGE' | 'FIXED';
export type DiscountCreator = 'ORGANIZER' | 'VENDOR';

export interface Discount {
    id: string;
    eventId: string;
    vendorId: string | null;
    scope: DiscountScope;
    targetItemIds: string[] | null;
    type: DiscountType;
    value: number;
    isActive: boolean;
    createdBy: DiscountCreator;
    createdAt: string;
    updatedAt: string;
}

export interface CreateDiscountInput {
    eventId: string;
    vendorId?: string;
    scope: DiscountScope;
    targetItemIds?: string[];
    type: DiscountType;
    value: number;
    createdBy: DiscountCreator;
}

export interface UpdateDiscountInput {
    scope?: DiscountScope;
    targetItemIds?: string[] | null;
    type?: DiscountType;
    value?: number;
    isActive?: boolean;
}

/** Result of resolving the best discount for a single item */
export interface ResolvedDiscount {
    discountId: string;
    type: DiscountType;
    value: number;
    originalPrice: number;
    discountedPrice: number;
    /** Percentage saved, always positive regardless of discount type */
    discountPercentage: number;
    savings: number;
}
