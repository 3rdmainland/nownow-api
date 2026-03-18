// vendor.utils.ts

import {Vendor, VendorCategory, VendorMenuItem} from './vendor.types';

export function toDbVendor(vendor: Partial<Vendor>) {
    const dbVendor: any = {};

    if (vendor.name !== undefined) dbVendor.name = vendor.name;
    if (vendor.description !== undefined) dbVendor.description = vendor.description;
    if (vendor.phone !== undefined) dbVendor.phone = vendor.phone;
    if (vendor.email !== undefined) dbVendor.email = vendor.email;
    if (vendor.imageUrl !== undefined) dbVendor.image_url = vendor.imageUrl;
    if (vendor.logoUrl !== undefined) dbVendor.logo_url = vendor.logoUrl;
    // categoryId no longer mapped — handled via vendor_categories junction table
    if (vendor.cuisineType !== undefined) dbVendor.cuisine_type = vendor.cuisineType;
    if (vendor.rating !== undefined) dbVendor.rating = vendor.rating;
    if (vendor.totalReviews !== undefined) dbVendor.total_reviews = vendor.totalReviews;
    if (vendor.location !== undefined) dbVendor.location = vendor.location;
    if (vendor.hours !== undefined) dbVendor.hours = vendor.hours;
    if (vendor.isActive !== undefined) dbVendor.is_active = vendor.isActive;
    if (vendor.isPaused !== undefined) dbVendor.is_paused = vendor.isPaused;
    if (vendor.minimumOrder !== undefined) dbVendor.minimum_order = vendor.minimumOrder;
    if (vendor.deliveryFee !== undefined) dbVendor.delivery_fee = vendor.deliveryFee;
    if (vendor.serviceFeePercent !== undefined) dbVendor.service_fee_percent = vendor.serviceFeePercent;
    if (vendor.estimatedPrepTime !== undefined) dbVendor.estimated_prep_time = vendor.estimatedPrepTime;
    if (vendor.paymentMethods !== undefined) dbVendor.payment_methods = vendor.paymentMethods;

    return dbVendor;
}

export function fromDbVendor(dbVendor: any): Vendor {
    // Build categoryIds and categories from joined vendor_categories data
    let categoryIds: string[] = [];
    let categories: VendorCategory[] | undefined;

    if (Array.isArray(dbVendor.vendor_categories) && dbVendor.vendor_categories.length > 0) {
        categoryIds = dbVendor.vendor_categories.map((vc: any) => vc.category_id);
        // If categories were joined (nested), extract them
        const withNames = dbVendor.vendor_categories.filter((vc: any) => vc.categories);
        if (withNames.length > 0) {
            categories = withNames.map((vc: any) => ({
                id: vc.categories.id,
                name: vc.categories.name,
            }));
        }
    } else if (dbVendor.category_id) {
        // Fallback to legacy column
        categoryIds = [dbVendor.category_id];
    }

    return {
        id: dbVendor.id,
        name: dbVendor.name,
        description: dbVendor.description,
        phone: dbVendor.phone,
        email: dbVendor.email,
        imageUrl: dbVendor.image_url,
        logoUrl: dbVendor.logo_url,
        categoryId: categoryIds[0] || dbVendor.category_id,
        categoryIds,
        categories,
        cuisineType: dbVendor.cuisine_type,
        rating: dbVendor.rating,
        totalReviews: dbVendor.total_reviews,
        location: dbVendor.location,
        hours: dbVendor.hours,
        isActive: dbVendor.is_active,
        isPaused: dbVendor.is_paused,
        minimumOrder: dbVendor.minimum_order,
        deliveryFee: dbVendor.delivery_fee,
        serviceFeePercent: dbVendor.service_fee_percent,
        estimatedPrepTime: dbVendor.estimated_prep_time,
        paymentMethods: dbVendor.payment_methods,
        createdAt: dbVendor.created_at,
        updatedAt: dbVendor.updated_at
    };
}

export function toDbMenuItem(item: Partial<VendorMenuItem>) {
    const dbItem: any = {};

    if (item.vendorId !== undefined) dbItem.vendor_id = item.vendorId;
    if (item.categoryId !== undefined) dbItem.category_id = item.categoryId;
    if (item.name !== undefined) dbItem.name = item.name;
    if (item.description !== undefined) dbItem.description = item.description;
    if (item.price !== undefined) dbItem.price = item.price;
    if (item.imageUrl !== undefined) dbItem.image_url = item.imageUrl;
    if (item.type !== undefined) dbItem.type = item.type;
    if (item.prepTime !== undefined) dbItem.prep_time = item.prepTime;
    if (item.available !== undefined) dbItem.available = item.available;
    if (item.isAlcohol !== undefined) dbItem.is_alcohol = item.isAlcohol;

    return dbItem;
}

export function fromDbMenuItem(dbItem: any): VendorMenuItem {
    return {
        id: dbItem.id,
        vendorId: dbItem.vendor_id,
        categoryId: dbItem.category_id,
        name: dbItem.name,
        description: dbItem.description,
        price: dbItem.price,
        imageUrl: dbItem.image_url,
        type: dbItem.type,
        prepTime: dbItem.prep_time,
        available: dbItem.available,
        isAlcohol: dbItem.is_alcohol ?? false,
        tags: dbItem.tags || [],
        createdAt: dbItem.created_at,
        updatedAt: dbItem.updated_at
    };
}
