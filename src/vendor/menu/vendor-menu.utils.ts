/**
 * Vendor Menu Utilities
 * Handles database mapping, validation, and helper functions
 */

import {
    DefaultMenuItem,
    EventMenuItem,
    ResolvedEventMenuItem,
    MenuCategory,
    ModifierGroup,
    Modifier,
    Tag,
    MenuTemplate,
    EventMenuConfiguration,
    PriceAdjustment,
    AvailabilityStatus,
    NutritionalInfo,
    MenuValidationResult,
    MenuValidationError,
    MenuValidationWarning,
    CreateDefaultMenuItemInput,
    CreateEventMenuItemInput,
} from './vendor-menu.types';

// ==================== DATABASE MAPPING ====================

/**
 * Convert API menu item to database format
 */
export function toDbDefaultMenuItem(item: Partial<DefaultMenuItem>): Record<string, any> {
    const dbItem: Record<string, any> = {};

    if (item.vendorId !== undefined) dbItem.vendor_id = item.vendorId;
    if (item.categoryId !== undefined) dbItem.category_id = item.categoryId;
    if (item.sku !== undefined) dbItem.sku = item.sku;
    if (item.name !== undefined) dbItem.name = item.name;
    if (item.slug !== undefined) dbItem.slug = item.slug;
    if (item.description !== undefined) dbItem.description = item.description;
    if (item.shortDescription !== undefined) dbItem.short_description = item.shortDescription;
    if (item.imageUrl !== undefined) dbItem.image_url = item.imageUrl;
    if (item.images !== undefined) dbItem.images = item.images;
    if (item.type !== undefined) dbItem.type = item.type;
    if (item.basePrice !== undefined) dbItem.base_price = item.basePrice;
    if (item.costPrice !== undefined) dbItem.cost_price = item.costPrice;
    if (item.pricingStrategy !== undefined) dbItem.pricing_strategy = item.pricingStrategy;
    if (item.prepTime !== undefined) dbItem.prep_time = item.prepTime;
    if (item.cookingInstructions !== undefined) dbItem.cooking_instructions = item.cookingInstructions;
    if (item.trackInventory !== undefined) dbItem.track_inventory = item.trackInventory;
    if (item.stockQuantity !== undefined) dbItem.stock_quantity = item.stockQuantity;
    if (item.lowStockThreshold !== undefined) dbItem.low_stock_threshold = item.lowStockThreshold;
    if (item.availabilityStatus !== undefined) dbItem.availability_status = item.availabilityStatus;
    if (item.tagIds !== undefined) dbItem.tag_ids = item.tagIds;
    if (item.modifierGroupIds !== undefined) dbItem.modifier_group_ids = item.modifierGroupIds;
    if (item.displayOrder !== undefined) dbItem.display_order = item.displayOrder;
    if (item.isFeatured !== undefined) dbItem.is_featured = item.isFeatured;
    if (item.isPopular !== undefined) dbItem.is_popular = item.isPopular;
    if (item.nutritionalInfo !== undefined) dbItem.nutritional_info = item.nutritionalInfo;
    if (item.isActive !== undefined) dbItem.is_active = item.isActive;

    return dbItem;
}

/**
 * Convert database menu item to API format
 */
export function fromDbDefaultMenuItem(dbItem: Record<string, any>): DefaultMenuItem {
    return {
        id: dbItem.id,
        vendorId: dbItem.vendor_id,
        categoryId: dbItem.category_id,
        sku: dbItem.sku,
        name: dbItem.name,
        slug: dbItem.slug,
        description: dbItem.description,
        shortDescription: dbItem.short_description,
        imageUrl: dbItem.image_url,
        images: dbItem.images || [],
        type: dbItem.type,
        basePrice: dbItem.base_price,
        costPrice: dbItem.cost_price,
        pricingStrategy: dbItem.pricing_strategy || 'FIXED',
        prepTime: dbItem.prep_time,
        cookingInstructions: dbItem.cooking_instructions,
        trackInventory: dbItem.track_inventory || false,
        stockQuantity: dbItem.stock_quantity,
        lowStockThreshold: dbItem.low_stock_threshold,
        availabilityStatus: dbItem.availability_status || 'AVAILABLE',
        tagIds: dbItem.tag_ids || [],
        modifierGroupIds: dbItem.modifier_group_ids || [],
        displayOrder: dbItem.display_order || 0,
        isFeatured: dbItem.is_featured || false,
        isPopular: dbItem.is_popular || false,
        nutritionalInfo: dbItem.nutritional_info,
        isActive: dbItem.is_active ?? true,
        scope: 'DEFAULT',
        createdAt: dbItem.created_at,
        updatedAt: dbItem.updated_at,
    };
}

/**
 * Convert API event menu item to database format
 */
export function toDbEventMenuItem(item: Partial<EventMenuItem>): Record<string, any> {
    const dbItem: Record<string, any> = {};

    if (item.eventId !== undefined) dbItem.event_id = item.eventId;
    if (item.vendorId !== undefined) dbItem.vendor_id = item.vendorId;
    if (item.defaultMenuItemId !== undefined) dbItem.default_menu_item_id = item.defaultMenuItemId;
    if (item.priceOverride !== undefined) dbItem.price_override = item.priceOverride;
    if (item.availabilityOverride !== undefined) dbItem.availability_override = item.availabilityOverride;
    if (item.prepTimeOverride !== undefined) dbItem.prep_time_override = item.prepTimeOverride;
    if (item.stockQuantityOverride !== undefined) dbItem.stock_quantity_override = item.stockQuantityOverride;
    if (item.isIncluded !== undefined) dbItem.is_included = item.isIncluded;
    if (item.displayOrderOverride !== undefined) dbItem.display_order_override = item.displayOrderOverride;
    if (item.isFeaturedAtEvent !== undefined) dbItem.is_featured_at_event = item.isFeaturedAtEvent;
    if (item.maxOrdersPerCustomer !== undefined) dbItem.max_orders_per_customer = item.maxOrdersPerCustomer;
    if (item.maxTotalOrders !== undefined) dbItem.max_total_orders = item.maxTotalOrders;
    if (item.currentOrderCount !== undefined) dbItem.current_order_count = item.currentOrderCount;
    if (item.availableFrom !== undefined) dbItem.available_from = item.availableFrom;
    if (item.availableTo !== undefined) dbItem.available_to = item.availableTo;
    if (item.eventNotes !== undefined) dbItem.event_notes = item.eventNotes;

    return dbItem;
}

/**
 * Convert database event menu item to API format
 */
export function fromDbEventMenuItem(dbItem: Record<string, any>): EventMenuItem {
    return {
        id: dbItem.id,
        eventId: dbItem.event_id,
        vendorId: dbItem.vendor_id,
        defaultMenuItemId: dbItem.default_menu_item_id,
        priceOverride: dbItem.price_override,
        availabilityOverride: dbItem.availability_override,
        prepTimeOverride: dbItem.prep_time_override,
        stockQuantityOverride: dbItem.stock_quantity_override,
        isIncluded: dbItem.is_included ?? true,
        displayOrderOverride: dbItem.display_order_override,
        isFeaturedAtEvent: dbItem.is_featured_at_event || false,
        maxOrdersPerCustomer: dbItem.max_orders_per_customer,
        maxTotalOrders: dbItem.max_total_orders,
        currentOrderCount: dbItem.current_order_count || 0,
        availableFrom: dbItem.available_from,
        availableTo: dbItem.available_to,
        eventNotes: dbItem.event_notes,
        createdAt: dbItem.created_at,
        updatedAt: dbItem.updated_at,
    };
}

/**
 * Convert API menu category to database format
 */
export function toDbMenuCategory(category: Partial<MenuCategory>): Record<string, any> {
    const dbCategory: Record<string, any> = {};

    if (category.vendorId !== undefined) dbCategory.vendor_id = category.vendorId;
    if (category.parentId !== undefined) dbCategory.parent_id = category.parentId;
    if (category.name !== undefined) dbCategory.name = category.name;
    if (category.slug !== undefined) dbCategory.slug = category.slug;
    if (category.description !== undefined) dbCategory.description = category.description;
    if (category.imageUrl !== undefined) dbCategory.image_url = category.imageUrl;
    if (category.displayOrder !== undefined) dbCategory.display_order = category.displayOrder;
    if (category.isActive !== undefined) dbCategory.is_active = category.isActive;
    if (category.scheduleStart !== undefined) dbCategory.schedule_start = category.scheduleStart;
    if (category.scheduleEnd !== undefined) dbCategory.schedule_end = category.scheduleEnd;
    if (category.availableDays !== undefined) dbCategory.available_days = category.availableDays;

    return dbCategory;
}

/**
 * Convert database menu category to API format
 */
export function fromDbMenuCategory(dbCategory: Record<string, any>): MenuCategory {
    return {
        id: dbCategory.id,
        vendorId: dbCategory.vendor_id,
        parentId: dbCategory.parent_id,
        name: dbCategory.name,
        slug: dbCategory.slug,
        description: dbCategory.description,
        imageUrl: dbCategory.image_url,
        displayOrder: dbCategory.display_order || 0,
        isActive: dbCategory.is_active ?? true,
        scheduleStart: dbCategory.schedule_start,
        scheduleEnd: dbCategory.schedule_end,
        availableDays: dbCategory.available_days,
        createdAt: dbCategory.created_at,
        updatedAt: dbCategory.updated_at,
    };
}

/**
 * Convert API modifier group to database format
 */
export function toDbModifierGroup(group: Partial<ModifierGroup>): Record<string, any> {
    const dbGroup: Record<string, any> = {};

    if (group.vendorId !== undefined) dbGroup.vendor_id = group.vendorId;
    if (group.name !== undefined) dbGroup.name = group.name;
    if (group.description !== undefined) dbGroup.description = group.description;
    if (group.selectionType !== undefined) dbGroup.selection_type = group.selectionType;
    if (group.isRequired !== undefined) dbGroup.is_required = group.isRequired;
    if (group.minSelections !== undefined) dbGroup.min_selections = group.minSelections;
    if (group.maxSelections !== undefined) dbGroup.max_selections = group.maxSelections;
    if (group.displayOrder !== undefined) dbGroup.display_order = group.displayOrder;
    if (group.isActive !== undefined) dbGroup.is_active = group.isActive;

    return dbGroup;
}

/**
 * Convert database modifier group to API format
 */
export function fromDbModifierGroup(dbGroup: Record<string, any>, modifiers: Modifier[] = []): ModifierGroup {
    return {
        id: dbGroup.id,
        vendorId: dbGroup.vendor_id,
        name: dbGroup.name,
        description: dbGroup.description,
        selectionType: dbGroup.selection_type,
        isRequired: dbGroup.is_required || false,
        minSelections: dbGroup.min_selections || 0,
        maxSelections: dbGroup.max_selections || 1,
        modifiers,
        displayOrder: dbGroup.display_order || 0,
        isActive: dbGroup.is_active ?? true,
        createdAt: dbGroup.created_at,
        updatedAt: dbGroup.updated_at,
    };
}

/**
 * Convert API modifier to database format
 */
export function toDbModifier(modifier: Partial<Modifier>): Record<string, any> {
    const dbModifier: Record<string, any> = {};

    if (modifier.groupId !== undefined) dbModifier.group_id = modifier.groupId;
    if (modifier.name !== undefined) dbModifier.name = modifier.name;
    if (modifier.description !== undefined) dbModifier.description = modifier.description;
    if (modifier.priceAdjustment !== undefined) dbModifier.price_adjustment = modifier.priceAdjustment;
    if (modifier.isDefault !== undefined) dbModifier.is_default = modifier.isDefault;
    if (modifier.isAvailable !== undefined) dbModifier.is_available = modifier.isAvailable;
    if (modifier.displayOrder !== undefined) dbModifier.display_order = modifier.displayOrder;
    if (modifier.nutritionalInfo !== undefined) dbModifier.nutritional_info = modifier.nutritionalInfo;

    return dbModifier;
}

/**
 * Convert database modifier to API format
 */
export function fromDbModifier(dbModifier: Record<string, any>): Modifier {
    return {
        id: dbModifier.id,
        groupId: dbModifier.group_id,
        name: dbModifier.name,
        description: dbModifier.description,
        priceAdjustment: dbModifier.price_adjustment || 0,
        isDefault: dbModifier.is_default || false,
        isAvailable: dbModifier.is_available ?? true,
        displayOrder: dbModifier.display_order || 0,
        nutritionalInfo: dbModifier.nutritional_info,
        createdAt: dbModifier.created_at,
        updatedAt: dbModifier.updated_at,
    };
}

/**
 * Convert API tag to database format
 */
export function toDbTag(tag: Partial<Tag>): Record<string, any> {
    const dbTag: Record<string, any> = {};

    if (tag.name !== undefined) dbTag.name = tag.name;
    if (tag.slug !== undefined) dbTag.slug = tag.slug;
    if (tag.description !== undefined) dbTag.description = tag.description;
    if (tag.color !== undefined) dbTag.color = tag.color;
    if (tag.icon !== undefined) dbTag.icon = tag.icon;
    if (tag.category !== undefined) dbTag.category = tag.category;
    if (tag.isActive !== undefined) dbTag.is_active = tag.isActive;

    return dbTag;
}

/**
 * Convert database tag to API format
 */
export function fromDbTag(dbTag: Record<string, any>): Tag {
    return {
        id: dbTag.id,
        name: dbTag.name,
        slug: dbTag.slug,
        description: dbTag.description,
        color: dbTag.color,
        icon: dbTag.icon,
        category: dbTag.category,
        isActive: dbTag.is_active ?? true,
        createdAt: dbTag.created_at,
        updatedAt: dbTag.updated_at,
    };
}

/**
 * Convert API menu template to database format
 */
export function toDbMenuTemplate(template: Partial<MenuTemplate>): Record<string, any> {
    const dbTemplate: Record<string, any> = {};

    if (template.vendorId !== undefined) dbTemplate.vendor_id = template.vendorId;
    if (template.name !== undefined) dbTemplate.name = template.name;
    if (template.description !== undefined) dbTemplate.description = template.description;
    if (template.templateType !== undefined) dbTemplate.template_type = template.templateType;
    if (template.includedCategoryIds !== undefined) dbTemplate.included_category_ids = template.includedCategoryIds;
    if (template.includedItemIds !== undefined) dbTemplate.included_item_ids = template.includedItemIds;
    if (template.excludedItemIds !== undefined) dbTemplate.excluded_item_ids = template.excludedItemIds;
    if (template.defaultPriceAdjustment !== undefined) dbTemplate.default_price_adjustment = template.defaultPriceAdjustment;
    if (template.defaultPrepTimeAdjustment !== undefined) dbTemplate.default_prep_time_adjustment = template.defaultPrepTimeAdjustment;
    if (template.itemOverrides !== undefined) dbTemplate.item_overrides = template.itemOverrides;
    if (template.isDefault !== undefined) dbTemplate.is_default = template.isDefault;
    if (template.usageCount !== undefined) dbTemplate.usage_count = template.usageCount;
    if (template.lastUsedAt !== undefined) dbTemplate.last_used_at = template.lastUsedAt;
    if (template.isActive !== undefined) dbTemplate.is_active = template.isActive;

    return dbTemplate;
}

/**
 * Convert database menu template to API format
 */
export function fromDbMenuTemplate(dbTemplate: Record<string, any>): MenuTemplate {
    return {
        id: dbTemplate.id,
        vendorId: dbTemplate.vendor_id,
        name: dbTemplate.name,
        description: dbTemplate.description,
        templateType: dbTemplate.template_type,
        includedCategoryIds: dbTemplate.included_category_ids || [],
        includedItemIds: dbTemplate.included_item_ids || [],
        excludedItemIds: dbTemplate.excluded_item_ids || [],
        defaultPriceAdjustment: dbTemplate.default_price_adjustment,
        defaultPrepTimeAdjustment: dbTemplate.default_prep_time_adjustment,
        itemOverrides: dbTemplate.item_overrides || [],
        isDefault: dbTemplate.is_default || false,
        usageCount: dbTemplate.usage_count || 0,
        lastUsedAt: dbTemplate.last_used_at,
        isActive: dbTemplate.is_active ?? true,
        createdAt: dbTemplate.created_at,
        updatedAt: dbTemplate.updated_at,
    };
}

/**
 * Convert API event menu configuration to database format
 */
export function toDbEventMenuConfig(config: Partial<EventMenuConfiguration>): Record<string, any> {
    const dbConfig: Record<string, any> = {};

    if (config.eventId !== undefined) dbConfig.event_id = config.eventId;
    if (config.vendorId !== undefined) dbConfig.vendor_id = config.vendorId;
    if (config.templateId !== undefined) dbConfig.template_id = config.templateId;
    if (config.globalPriceAdjustment !== undefined) dbConfig.global_price_adjustment = config.globalPriceAdjustment;
    if (config.allowPayAtStall !== undefined) dbConfig.allow_pay_at_stall = config.allowPayAtStall;
    if (config.isAcceptingOrders !== undefined) dbConfig.is_accepting_orders = config.isAcceptingOrders;
    if (config.maxConcurrentOrders !== undefined) dbConfig.max_concurrent_orders = config.maxConcurrentOrders;
    if (config.currentActiveOrders !== undefined) dbConfig.current_active_orders = config.currentActiveOrders;
    if (config.orderCooldownMinutes !== undefined) dbConfig.order_cooldown_minutes = config.orderCooldownMinutes;
    if (config.maxOrdersPerCustomerEvent !== undefined) dbConfig.max_orders_per_customer_event = config.maxOrdersPerCustomerEvent;
    if (config.eventOpenTime !== undefined) dbConfig.event_open_time = config.eventOpenTime;
    if (config.eventCloseTime !== undefined) dbConfig.event_close_time = config.eventCloseTime;
    if (config.operatingSchedule !== undefined) dbConfig.operating_schedule = config.operatingSchedule;
    if (config.minimumOrderValue !== undefined) dbConfig.minimum_order_value = config.minimumOrderValue;
    if (config.serviceFeePercent !== undefined) dbConfig.service_fee_percent = config.serviceFeePercent;
    if (config.prepTimeBufferMinutes !== undefined) dbConfig.prep_time_buffer_minutes = config.prepTimeBufferMinutes;
    if (config.estimatedWaitMinutes !== undefined) dbConfig.estimated_wait_minutes = config.estimatedWaitMinutes;
    if (config.boothInfo !== undefined) dbConfig.booth_info = config.boothInfo;
    if (config.vendorNotice !== undefined) dbConfig.vendor_notice = config.vendorNotice;
    if (config.categoryConfigurations !== undefined) dbConfig.category_configurations = config.categoryConfigurations;
    if (config.status !== undefined) dbConfig.status = config.status;
    if (config.publishedAt !== undefined) dbConfig.published_at = config.publishedAt;

    return dbConfig;
}

/**
 * Convert database event menu configuration to API format
 */
export function fromDbEventMenuConfig(
    dbConfig: Record<string, any>,
    menuItems: EventMenuItem[] = []
): EventMenuConfiguration {
    return {
        id: dbConfig.id,
        eventId: dbConfig.event_id,
        vendorId: dbConfig.vendor_id,
        templateId: dbConfig.template_id,
        menuItems,
        categoryConfigurations: dbConfig.category_configurations || [],
        globalPriceAdjustment: dbConfig.global_price_adjustment,
        allowPayAtStall: dbConfig.allow_pay_at_stall ?? false,
        isAcceptingOrders: dbConfig.is_accepting_orders ?? true,
        maxConcurrentOrders: dbConfig.max_concurrent_orders,
        currentActiveOrders: dbConfig.current_active_orders || 0,
        orderCooldownMinutes: dbConfig.order_cooldown_minutes,
        maxOrdersPerCustomerEvent: dbConfig.max_orders_per_customer_event,
        eventOpenTime: dbConfig.event_open_time,
        eventCloseTime: dbConfig.event_close_time,
        operatingSchedule: dbConfig.operating_schedule || [],
        minimumOrderValue: dbConfig.minimum_order_value,
        serviceFeePercent: dbConfig.service_fee_percent,
        prepTimeBufferMinutes: dbConfig.prep_time_buffer_minutes,
        estimatedWaitMinutes: dbConfig.estimated_wait_minutes,
        boothInfo: dbConfig.booth_info,
        vendorNotice: dbConfig.vendor_notice,
        status: dbConfig.status || 'DRAFT',
        publishedAt: dbConfig.published_at,
        createdAt: dbConfig.created_at,
        updatedAt: dbConfig.updated_at,
    };
}

// ==================== RESOLUTION FUNCTIONS ====================

/**
 * Resolve event menu item with defaults
 * Combines default menu item values with event-specific overrides
 */
export function resolveEventMenuItem(
    defaultItem: DefaultMenuItem,
    eventItem: EventMenuItem
): ResolvedEventMenuItem {
    const overriddenFields: string[] = [];

    // Determine effective values
    const effectivePrice = eventItem.priceOverride ?? defaultItem.basePrice;
    if (eventItem.priceOverride !== null && eventItem.priceOverride !== undefined) {
        overriddenFields.push('price');
    }

    const effectiveAvailability = eventItem.availabilityOverride ?? defaultItem.availabilityStatus;
    if (eventItem.availabilityOverride !== null && eventItem.availabilityOverride !== undefined) {
        overriddenFields.push('availability');
    }

    const effectivePrepTime = eventItem.prepTimeOverride ?? defaultItem.prepTime;
    if (eventItem.prepTimeOverride !== null && eventItem.prepTimeOverride !== undefined) {
        overriddenFields.push('prepTime');
    }

    const effectiveStockQuantity = eventItem.stockQuantityOverride ?? defaultItem.stockQuantity;
    if (eventItem.stockQuantityOverride !== null && eventItem.stockQuantityOverride !== undefined) {
        overriddenFields.push('stockQuantity');
    }

    const effectiveDisplayOrder = eventItem.displayOrderOverride ?? defaultItem.displayOrder;
    if (eventItem.displayOrderOverride !== null && eventItem.displayOrderOverride !== undefined) {
        overriddenFields.push('displayOrder');
    }

    // Calculate remaining orders if max is set
    let remainingOrders: number | undefined;
    if (eventItem.maxTotalOrders !== null && eventItem.maxTotalOrders !== undefined) {
        remainingOrders = Math.max(0, eventItem.maxTotalOrders - eventItem.currentOrderCount);
    }

    return {
        // Base menu item properties
        id: defaultItem.id,
        vendorId: defaultItem.vendorId,
        categoryId: defaultItem.categoryId,
        sku: defaultItem.sku,
        name: defaultItem.name,
        slug: defaultItem.slug,
        description: defaultItem.description,
        shortDescription: defaultItem.shortDescription,
        imageUrl: defaultItem.imageUrl,
        images: defaultItem.images,
        type: defaultItem.type,
        basePrice: defaultItem.basePrice,
        costPrice: defaultItem.costPrice,
        pricingStrategy: defaultItem.pricingStrategy,
        prepTime: defaultItem.prepTime,
        cookingInstructions: defaultItem.cookingInstructions,
        trackInventory: defaultItem.trackInventory,
        stockQuantity: defaultItem.stockQuantity,
        lowStockThreshold: defaultItem.lowStockThreshold,
        availabilityStatus: defaultItem.availabilityStatus,
        tagIds: defaultItem.tagIds,
        modifierGroupIds: defaultItem.modifierGroupIds,
        displayOrder: effectiveDisplayOrder,
        isFeatured: defaultItem.isFeatured,
        isPopular: defaultItem.isPopular,
        nutritionalInfo: defaultItem.nutritionalInfo,
        isActive: defaultItem.isActive,
        createdAt: defaultItem.createdAt,
        updatedAt: defaultItem.updatedAt,

        // Event-specific
        eventId: eventItem.eventId,
        eventMenuItemId: eventItem.id,

        // Resolved values
        effectivePrice,
        effectiveAvailability,
        effectivePrepTime,
        effectiveStockQuantity,

        // Event-specific properties
        isIncludedInEvent: eventItem.isIncluded,
        isFeaturedAtEvent: eventItem.isFeaturedAtEvent,
        maxOrdersPerCustomer: eventItem.maxOrdersPerCustomer,
        remainingOrders,
        availableFrom: eventItem.availableFrom,
        availableTo: eventItem.availableTo,

        // Source tracking
        hasEventOverrides: overriddenFields.length > 0,
        overriddenFields,
    };
}

/**
 * Apply price adjustment to a value
 */
export function applyPriceAdjustment(basePrice: number, adjustment: PriceAdjustment): number {
    let adjustedPrice = basePrice;

    if (adjustment.type === 'PERCENTAGE') {
        const adjustmentAmount = basePrice * (adjustment.value / 100);
        adjustedPrice = adjustment.direction === 'INCREASE'
            ? basePrice + adjustmentAmount
            : basePrice - adjustmentAmount;
    } else {
        adjustedPrice = adjustment.direction === 'INCREASE'
            ? basePrice + adjustment.value
            : basePrice - adjustment.value;
    }

    // Ensure price is not negative
    return Math.max(0, Math.round(adjustedPrice * 100) / 100);
}

// ==================== VALIDATION FUNCTIONS ====================

/**
 * Validate default menu item input
 */
export function validateDefaultMenuItemInput(
    input: CreateDefaultMenuItemInput
): MenuValidationResult {
    const errors: MenuValidationError[] = [];
    const warnings: MenuValidationWarning[] = [];

    // Required fields
    if (!input.name || input.name.trim().length === 0) {
        errors.push({ field: 'name', message: 'Name is required' });
    } else if (input.name.length > 200) {
        errors.push({ field: 'name', message: 'Name must be 200 characters or less' });
    }

    if (!input.categoryId) {
        errors.push({ field: 'categoryId', message: 'Category is required' });
    }

    if (input.basePrice === undefined || input.basePrice === null) {
        errors.push({ field: 'basePrice', message: 'Base price is required' });
    } else if (input.basePrice < 0) {
        errors.push({ field: 'basePrice', message: 'Base price cannot be negative' });
    }

    if (!input.type) {
        errors.push({ field: 'type', message: 'Item type is required' });
    }

    // Optional field validations
    if (input.description && input.description.length > 2000) {
        errors.push({ field: 'description', message: 'Description must be 2000 characters or less' });
    }

    if (input.prepTime !== undefined && input.prepTime < 0) {
        errors.push({ field: 'prepTime', message: 'Prep time cannot be negative' });
    }

    if (input.stockQuantity !== undefined && input.stockQuantity < 0) {
        errors.push({ field: 'stockQuantity', message: 'Stock quantity cannot be negative' });
    }

    // Warnings
    if (!input.description) {
        warnings.push({
            field: 'description',
            message: 'No description provided',
            suggestion: 'Adding a description helps customers understand what they\'re ordering',
        });
    }

    if (!input.imageUrl) {
        warnings.push({
            field: 'imageUrl',
            message: 'No image provided',
            suggestion: 'Items with images typically perform better',
        });
    }

    if (input.costPrice !== undefined && input.costPrice >= input.basePrice) {
        warnings.push({
            field: 'costPrice',
            message: 'Cost price is equal to or higher than base price',
            suggestion: 'This item may not be profitable',
        });
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Validate event menu item input
 */
export function validateEventMenuItemInput(
    input: CreateEventMenuItemInput
): MenuValidationResult {
    const errors: MenuValidationError[] = [];
    const warnings: MenuValidationWarning[] = [];

    // Required fields
    if (!input.eventId) {
        errors.push({ field: 'eventId', message: 'Event ID is required' });
    }

    if (!input.defaultMenuItemId) {
        errors.push({ field: 'defaultMenuItemId', message: 'Default menu item ID is required' });
    }

    // Optional field validations
    if (input.priceOverride !== undefined && input.priceOverride < 0) {
        errors.push({ field: 'priceOverride', message: 'Price override cannot be negative' });
    }

    if (input.prepTimeOverride !== undefined && input.prepTimeOverride < 0) {
        errors.push({ field: 'prepTimeOverride', message: 'Prep time override cannot be negative' });
    }

    if (input.maxOrdersPerCustomer !== undefined && input.maxOrdersPerCustomer < 1) {
        errors.push({ field: 'maxOrdersPerCustomer', message: 'Max orders per customer must be at least 1' });
    }

    if (input.maxTotalOrders !== undefined && input.maxTotalOrders < 1) {
        errors.push({ field: 'maxTotalOrders', message: 'Max total orders must be at least 1' });
    }

    // Date validation
    if (input.availableFrom && input.availableTo) {
        const from = new Date(input.availableFrom);
        const to = new Date(input.availableTo);
        if (from >= to) {
            errors.push({
                field: 'availableFrom',
                message: 'Available from date must be before available to date',
            });
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Generate a URL-friendly slug from a string
 */
export function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 100);
}

/**
 * Calculate margin percentage
 */
export function calculateMargin(basePrice: number, costPrice: number): number {
    if (basePrice === 0) return 0;
    return Math.round(((basePrice - costPrice) / basePrice) * 100 * 100) / 100;
}

/**
 * Check if a menu item is available at a specific time
 */
export function isItemAvailableAtTime(
    item: ResolvedEventMenuItem,
    checkTime: Date = new Date()
): boolean {
    // Check basic availability
    if (!item.isIncludedInEvent) return false;
    if (item.effectiveAvailability !== 'AVAILABLE') return false;

    // Check time-based availability
    if (item.availableFrom) {
        const from = new Date(item.availableFrom);
        if (checkTime < from) return false;
    }

    if (item.availableTo) {
        const to = new Date(item.availableTo);
        if (checkTime > to) return false;
    }

    // Check remaining orders
    if (item.remainingOrders !== undefined && item.remainingOrders <= 0) {
        return false;
    }

    return true;
}

/**
 * Group menu items by category
 */
export function groupItemsByCategory<T extends { categoryId: string }>(
    items: T[],
    categories: MenuCategory[]
): Map<MenuCategory, T[]> {
    const grouped = new Map<MenuCategory, T[]>();
    const categoryMap = new Map(categories.map(c => [c.id, c]));

    for (const item of items) {
        const category = categoryMap.get(item.categoryId);
        if (category) {
            const existing = grouped.get(category) || [];
            existing.push(item);
            grouped.set(category, existing);
        }
    }

    return grouped;
}

/**
 * Sort menu items by display order
 */
export function sortByDisplayOrder<T extends { displayOrder: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Filter items by tags
 */
export function filterByTags<T extends { tagIds: string[] }>(
    items: T[],
    tagIds: string[],
    matchAll: boolean = false
): T[] {
    if (tagIds.length === 0) return items;

    return items.filter(item => {
        if (matchAll) {
            return tagIds.every(tagId => item.tagIds.includes(tagId));
        } else {
            return tagIds.some(tagId => item.tagIds.includes(tagId));
        }
    });
}

/**
 * Search menu items by name/description
 */
export function searchMenuItems<T extends { name: string; description?: string }>(
    items: T[],
    searchTerm: string
): T[] {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return items;

    return items.filter(item => {
        const nameMatch = item.name.toLowerCase().includes(term);
        const descMatch = item.description?.toLowerCase().includes(term) || false;
        return nameMatch || descMatch;
    });
}

/**
 * Calculate price range for a category
 */
export function getPriceRange(items: { basePrice: number }[]): { min: number; max: number } | null {
    if (items.length === 0) return null;

    const prices = items.map(i => i.basePrice);
    return {
        min: Math.min(...prices),
        max: Math.max(...prices),
    };
}

/**
 * Format price for display
 */
export function formatPrice(amount: number, currency: string = 'ZAR'): string {
    return new Intl.NumberFormat('en-ZA', {
        style: 'currency',
        currency,
    }).format(amount);
}
