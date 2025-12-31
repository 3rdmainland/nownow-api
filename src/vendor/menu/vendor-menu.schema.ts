/**
 * Vendor Menu API Schemas
 * Fastify JSON Schema definitions for request/response validation
 */

// ==================== SHARED PROPERTY DEFINITIONS ====================

const menuItemProperties = {
    id: { type: 'string' },
    vendorId: { type: 'string' },
    categoryId: { type: 'string' },
    sku: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string' },
    shortDescription: { type: 'string' },
    imageUrl: { type: 'string' },
    type: { type: 'string', enum: ['FOOD', 'BEVERAGE', 'RETAIL', 'SERVICE'] },
    basePrice: { type: 'number' },
    costPrice: { type: 'number' },
    pricingStrategy: { type: 'string', enum: ['FIXED', 'TIERED', 'TIME_BASED', 'DYNAMIC'] },
    prepTime: { type: 'number' },
    trackInventory: { type: 'boolean' },
    stockQuantity: { type: 'number' },
    lowStockThreshold: { type: 'number' },
    availabilityStatus: { type: 'string', enum: ['AVAILABLE', 'OUT_OF_STOCK', 'LIMITED', 'COMING_SOON', 'DISCONTINUED'] },
    tagIds: { type: 'array', items: { type: 'string' } },
    modifierGroupIds: { type: 'array', items: { type: 'string' } },
    displayOrder: { type: 'number' },
    isFeatured: { type: 'boolean' },
    isPopular: { type: 'boolean' },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
};

const categoryProperties = {
    id: { type: 'string' },
    vendorId: { type: 'string' },
    parentId: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string' },
    imageUrl: { type: 'string' },
    displayOrder: { type: 'number' },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
};

const modifierProperties = {
    id: { type: 'string' },
    groupId: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    priceAdjustment: { type: 'number' },
    isDefault: { type: 'boolean' },
    isAvailable: { type: 'boolean' },
    displayOrder: { type: 'number' },
};

const modifierGroupProperties = {
    id: { type: 'string' },
    vendorId: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    selectionType: { type: 'string', enum: ['SINGLE', 'MULTIPLE'] },
    isRequired: { type: 'boolean' },
    minSelections: { type: 'number' },
    maxSelections: { type: 'number' },
    modifiers: { type: 'array', items: { type: 'object', properties: modifierProperties } },
    displayOrder: { type: 'number' },
    isActive: { type: 'boolean' },
};

const tagProperties = {
    id: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string' },
    color: { type: 'string' },
    icon: { type: 'string' },
    category: { type: 'string', enum: ['DIETARY', 'ALLERGEN', 'SPICE_LEVEL', 'CUISINE', 'PREPARATION', 'FEATURE', 'CUSTOM'] },
    isActive: { type: 'boolean' },
};

const priceAdjustmentSchema = {
    type: 'object',
    properties: {
        type: { type: 'string', enum: ['PERCENTAGE', 'FIXED'] },
        value: { type: 'number' },
        direction: { type: 'string', enum: ['INCREASE', 'DECREASE'] },
    },
    required: ['type', 'value', 'direction'],
};

const eventMenuItemProperties = {
    id: { type: 'string' },
    eventId: { type: 'string' },
    vendorId: { type: 'string' },
    defaultMenuItemId: { type: 'string' },
    priceOverride: { type: 'number' },
    availabilityOverride: { type: 'string' },
    prepTimeOverride: { type: 'number' },
    stockQuantityOverride: { type: 'number' },
    isIncluded: { type: 'boolean' },
    displayOrderOverride: { type: 'number' },
    isFeaturedAtEvent: { type: 'boolean' },
    maxOrdersPerCustomer: { type: 'number' },
    maxTotalOrders: { type: 'number' },
    currentOrderCount: { type: 'number' },
    availableFrom: { type: 'string', format: 'date-time' },
    availableTo: { type: 'string', format: 'date-time' },
    eventNotes: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
};

const resolvedEventMenuItemProperties = {
    ...menuItemProperties,
    eventId: { type: 'string' },
    eventMenuItemId: { type: 'string' },
    effectivePrice: { type: 'number' },
    effectiveAvailability: { type: 'string' },
    effectivePrepTime: { type: 'number' },
    effectiveStockQuantity: { type: 'number' },
    isIncludedInEvent: { type: 'boolean' },
    isFeaturedAtEvent: { type: 'boolean' },
    maxOrdersPerCustomer: { type: 'number' },
    remainingOrders: { type: 'number' },
    availableFrom: { type: 'string', format: 'date-time' },
    availableTo: { type: 'string', format: 'date-time' },
    hasEventOverrides: { type: 'boolean' },
    overriddenFields: { type: 'array', items: { type: 'string' } },
};

const templateProperties = {
    id: { type: 'string' },
    vendorId: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    templateType: { type: 'string', enum: ['FULL_MENU', 'FESTIVAL', 'CORPORATE', 'QUICK_SERVICE', 'PREMIUM', 'BREAKFAST', 'LUNCH', 'DINNER', 'CUSTOM'] },
    includedCategoryIds: { type: 'array', items: { type: 'string' } },
    includedItemIds: { type: 'array', items: { type: 'string' } },
    excludedItemIds: { type: 'array', items: { type: 'string' } },
    defaultPriceAdjustment: priceAdjustmentSchema,
    defaultPrepTimeAdjustment: { type: 'number' },
    itemOverrides: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                menuItemId: { type: 'string' },
                priceOverride: { type: 'number' },
                isIncluded: { type: 'boolean' },
                displayOrderOverride: { type: 'number' },
            },
        },
    },
    isDefault: { type: 'boolean' },
    usageCount: { type: 'number' },
    lastUsedAt: { type: 'string', format: 'date-time' },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
};

const eventMenuConfigProperties = {
    id: { type: 'string' },
    eventId: { type: 'string' },
    vendorId: { type: 'string' },
    templateId: { type: 'string' },
    globalPriceAdjustment: priceAdjustmentSchema,
    isAcceptingOrders: { type: 'boolean' },
    maxConcurrentOrders: { type: 'number' },
    currentActiveOrders: { type: 'number' },
    orderCooldownMinutes: { type: 'number' },
    operatingSchedule: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                date: { type: 'string' },
                openTime: { type: 'string' },
                closeTime: { type: 'string' },
                isClosed: { type: 'boolean' },
            },
        },
    },
    categoryConfigurations: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                categoryId: { type: 'string' },
                isIncluded: { type: 'boolean' },
                displayOrderOverride: { type: 'number' },
                customNameOverride: { type: 'string' },
            },
        },
    },
    status: { type: 'string', enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'PAUSED', 'CLOSED'] },
    publishedAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
};

const errorResponse = {
    type: 'object',
    properties: { error: { type: 'string' } },
    required: ['error'],
};

// ==================== DEFAULT MENU SCHEMAS ====================

export const getDefaultMenuSchema = {
    description: 'Get complete default menu for a vendor',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    response: {
        200: {
            type: 'object',
            properties: {
                vendor: {
                    type: 'object',
                    properties: { id: { type: 'string' }, name: { type: 'string' } },
                },
                categories: { type: 'array', items: { type: 'object', properties: categoryProperties } },
                menuItems: { type: 'array', items: { type: 'object', properties: menuItemProperties } },
                modifierGroups: { type: 'array', items: { type: 'object', properties: modifierGroupProperties } },
                tags: { type: 'array', items: { type: 'object', properties: tagProperties } },
            },
        },
        500: errorResponse,
    },
};

export const getDefaultMenuItemSchema = {
    description: 'Get a single default menu item',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            itemId: { type: 'string' },
        },
        required: ['vendorId', 'itemId'],
    },
    response: {
        200: {
            type: 'object',
            properties: { menuItem: { type: 'object', properties: menuItemProperties } },
        },
        404: errorResponse,
        500: errorResponse,
    },
};

export const createDefaultMenuItemSchema = {
    description: 'Create a new default menu item',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    body: {
        type: 'object',
        required: ['name', 'categoryId', 'basePrice', 'type'],
        properties: {
            categoryId: { type: 'string' },
            sku: { type: 'string' },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 2000 },
            shortDescription: { type: 'string', maxLength: 200 },
            imageUrl: { type: 'string' },
            type: { type: 'string', enum: ['FOOD', 'BEVERAGE', 'RETAIL', 'SERVICE'] },
            basePrice: { type: 'number', minimum: 0 },
            costPrice: { type: 'number', minimum: 0 },
            pricingStrategy: { type: 'string', enum: ['FIXED', 'TIERED', 'TIME_BASED', 'DYNAMIC'] },
            prepTime: { type: 'number', minimum: 0 },
            trackInventory: { type: 'boolean' },
            stockQuantity: { type: 'number', minimum: 0 },
            lowStockThreshold: { type: 'number', minimum: 0 },
            tagIds: { type: 'array', items: { type: 'string' } },
            modifierGroupIds: { type: 'array', items: { type: 'string' } },
            displayOrder: { type: 'number' },
            isFeatured: { type: 'boolean' },
            nutritionalInfo: {
                type: 'object',
                properties: {
                    calories: { type: 'number' },
                    protein: { type: 'number' },
                    carbohydrates: { type: 'number' },
                    fat: { type: 'number' },
                    fiber: { type: 'number' },
                    sugar: { type: 'number' },
                    sodium: { type: 'number' },
                    servingSize: { type: 'string' },
                    allergens: { type: 'array', items: { type: 'string' } },
                },
            },
        },
    },
    response: {
        201: {
            type: 'object',
            properties: { menuItem: { type: 'object', properties: menuItemProperties } },
        },
        400: errorResponse,
        500: errorResponse,
    },
};

export const updateDefaultMenuItemSchema = {
    description: 'Update a default menu item',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            itemId: { type: 'string' },
        },
        required: ['vendorId', 'itemId'],
    },
    body: {
        type: 'object',
        properties: {
            categoryId: { type: 'string' },
            sku: { type: 'string' },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 2000 },
            shortDescription: { type: 'string', maxLength: 200 },
            imageUrl: { type: 'string' },
            type: { type: 'string', enum: ['FOOD', 'BEVERAGE', 'RETAIL', 'SERVICE'] },
            basePrice: { type: 'number', minimum: 0 },
            costPrice: { type: 'number', minimum: 0 },
            pricingStrategy: { type: 'string', enum: ['FIXED', 'TIERED', 'TIME_BASED', 'DYNAMIC'] },
            prepTime: { type: 'number', minimum: 0 },
            trackInventory: { type: 'boolean' },
            stockQuantity: { type: 'number', minimum: 0 },
            lowStockThreshold: { type: 'number', minimum: 0 },
            availabilityStatus: { type: 'string', enum: ['AVAILABLE', 'OUT_OF_STOCK', 'LIMITED', 'COMING_SOON', 'DISCONTINUED'] },
            tagIds: { type: 'array', items: { type: 'string' } },
            modifierGroupIds: { type: 'array', items: { type: 'string' } },
            displayOrder: { type: 'number' },
            isFeatured: { type: 'boolean' },
            isActive: { type: 'boolean' },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: { menuItem: { type: 'object', properties: menuItemProperties } },
        },
        500: errorResponse,
    },
};

export const deleteDefaultMenuItemSchema = {
    description: 'Delete a default menu item',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            itemId: { type: 'string' },
        },
        required: ['vendorId', 'itemId'],
    },
    response: {
        204: { type: 'null' },
        500: errorResponse,
    },
};

export const bulkCreateDefaultMenuItemsSchema = {
    description: 'Bulk create default menu items',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    body: {
        type: 'object',
        required: ['items'],
        properties: {
            items: {
                type: 'array',
                minItems: 1,
                maxItems: 100,
                items: {
                    type: 'object',
                    required: ['name', 'categoryId', 'basePrice', 'type'],
                    properties: {
                        categoryId: { type: 'string' },
                        name: { type: 'string' },
                        description: { type: 'string' },
                        basePrice: { type: 'number', minimum: 0 },
                        type: { type: 'string', enum: ['FOOD', 'BEVERAGE', 'RETAIL', 'SERVICE'] },
                        prepTime: { type: 'number' },
                        imageUrl: { type: 'string' },
                        tagIds: { type: 'array', items: { type: 'string' } },
                    },
                },
            },
        },
    },
    response: {
        201: {
            type: 'object',
            properties: {
                menuItems: { type: 'array', items: { type: 'object', properties: menuItemProperties } },
                count: { type: 'number' },
            },
        },
        400: errorResponse,
        500: errorResponse,
    },
};

// ==================== EVENT MENU SCHEMAS ====================

export const getEventMenuSchema = {
    description: 'Get complete event-specific menu',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
        },
        required: ['vendorId', 'eventId'],
    },
    response: {
        200: {
            type: 'object',
            properties: {
                event: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        startDate: { type: 'string' },
                        endDate: { type: 'string' },
                    },
                },
                vendor: {
                    type: 'object',
                    properties: { id: { type: 'string' }, name: { type: 'string' } },
                },
                configuration: { type: 'object', properties: eventMenuConfigProperties },
                categories: { type: 'array', items: { type: 'object', properties: categoryProperties } },
                menuItems: { type: 'array', items: { type: 'object', properties: resolvedEventMenuItemProperties } },
                modifierGroups: { type: 'array', items: { type: 'object', properties: modifierGroupProperties } },
                tags: { type: 'array', items: { type: 'object', properties: tagProperties } },
            },
        },
        500: errorResponse,
    },
};

export const upsertEventMenuItemSchema = {
    description: 'Create or update an event menu item override',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
        },
        required: ['vendorId', 'eventId'],
    },
    body: {
        type: 'object',
        required: ['defaultMenuItemId'],
        properties: {
            defaultMenuItemId: { type: 'string' },
            priceOverride: { type: 'number', minimum: 0 },
            availabilityOverride: { type: 'string', enum: ['AVAILABLE', 'OUT_OF_STOCK', 'LIMITED', 'COMING_SOON', 'DISCONTINUED'] },
            prepTimeOverride: { type: 'number', minimum: 0 },
            stockQuantityOverride: { type: 'number', minimum: 0 },
            isIncluded: { type: 'boolean' },
            displayOrderOverride: { type: 'number' },
            isFeaturedAtEvent: { type: 'boolean' },
            maxOrdersPerCustomer: { type: 'number', minimum: 1 },
            maxTotalOrders: { type: 'number', minimum: 1 },
            availableFrom: { type: 'string', format: 'date-time' },
            availableTo: { type: 'string', format: 'date-time' },
            eventNotes: { type: 'string' },
        },
    },
    response: {
        201: {
            type: 'object',
            properties: { eventMenuItem: { type: 'object', properties: eventMenuItemProperties } },
        },
        500: errorResponse,
    },
};

export const updateEventMenuItemSchema = {
    description: 'Update an event menu item',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
            eventItemId: { type: 'string' },
        },
        required: ['vendorId', 'eventId', 'eventItemId'],
    },
    body: {
        type: 'object',
        properties: {
            priceOverride: { type: ['number', 'null'] },
            availabilityOverride: { type: ['string', 'null'] },
            prepTimeOverride: { type: ['number', 'null'] },
            stockQuantityOverride: { type: ['number', 'null'] },
            isIncluded: { type: 'boolean' },
            displayOrderOverride: { type: ['number', 'null'] },
            isFeaturedAtEvent: { type: 'boolean' },
            maxOrdersPerCustomer: { type: ['number', 'null'] },
            maxTotalOrders: { type: ['number', 'null'] },
            availableFrom: { type: ['string', 'null'] },
            availableTo: { type: ['string', 'null'] },
            eventNotes: { type: ['string', 'null'] },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: { eventMenuItem: { type: 'object', properties: eventMenuItemProperties } },
        },
        500: errorResponse,
    },
};

export const getEventMenuItemSchema = {
    description: 'Get a single event menu item by ID with full details',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
            eventMenuItemId: { type: 'string' },
        },
        required: ['vendorId', 'eventId', 'eventMenuItemId'],
    },
    response: {
        200: {
            type: 'object',
            properties: {
                eventMenuItem: {
                    type: 'object',
                    additionalProperties: true
                }
            },
        },
        404: {
            type: 'object',
            properties: { error: { type: 'string' } },
        },
        500: errorResponse,
    },
};

export const bulkUpdateEventMenuItemsSchema = {
    description: 'Bulk update event menu items',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
        },
        required: ['vendorId', 'eventId'],
    },
    body: {
        type: 'object',
        required: ['updates'],
        properties: {
            updates: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['menuItemId', 'changes'],
                    properties: {
                        menuItemId: { type: 'string' },
                        changes: {
                            type: 'object',
                            properties: {
                                priceOverride: { type: ['number', 'null'] },
                                isIncluded: { type: 'boolean' },
                                isFeaturedAtEvent: { type: 'boolean' },
                            },
                        },
                    },
                },
            },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: {
                eventMenuItems: { type: 'array', items: { type: 'object', properties: eventMenuItemProperties } },
                count: { type: 'number' },
            },
        },
        500: errorResponse,
    },
};

export const bulkPriceAdjustmentSchema = {
    description: 'Apply bulk price adjustment to event menu items',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
        },
        required: ['vendorId', 'eventId'],
    },
    body: {
        type: 'object',
        required: ['adjustment'],
        properties: {
            categoryIds: { type: 'array', items: { type: 'string' } },
            itemIds: { type: 'array', items: { type: 'string' } },
            adjustment: priceAdjustmentSchema,
        },
    },
    response: {
        200: {
            type: 'object',
            properties: { updatedCount: { type: 'number' } },
        },
        500: errorResponse,
    },
};

export const resetEventMenuPricesSchema = {
    description: 'Reset event menu prices to defaults (removes all price overrides)',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
        },
        required: ['vendorId', 'eventId'],
    },
    body: {
        type: 'object',
        properties: {},
        additionalProperties: false,
    },
    response: {
        200: {
            type: 'object',
            properties: { resetCount: { type: 'number' } },
        },
        500: errorResponse,
    },
};

export const cloneEventMenuSchema = {
    description: 'Clone menu from another event',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
        },
        required: ['vendorId', 'eventId'],
    },
    body: {
        type: 'object',
        required: ['sourceEventId'],
        properties: {
            sourceEventId: { type: 'string' },
            includeOverrides: { type: 'boolean', default: false },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: { clonedCount: { type: 'number' } },
        },
        500: errorResponse,
    },
};

// ==================== EVENT CONFIG SCHEMAS ====================

export const getEventMenuConfigSchema = {
    description: 'Get event menu configuration',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
        },
        required: ['vendorId', 'eventId'],
    },
    response: {
        200: {
            type: 'object',
            properties: { configuration: { type: 'object', properties: eventMenuConfigProperties } },
        },
        500: errorResponse,
    },
};

export const updateEventMenuConfigSchema = {
    description: 'Update event menu configuration',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
        },
        required: ['vendorId', 'eventId'],
    },
    body: {
        type: 'object',
        properties: {
            templateId: { type: ['string', 'null'] },
            globalPriceAdjustment: { oneOf: [priceAdjustmentSchema, { type: 'null' }] },
            isAcceptingOrders: { type: 'boolean' },
            maxConcurrentOrders: { type: ['number', 'null'] },
            orderCooldownMinutes: { type: ['number', 'null'] },
            operatingSchedule: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        date: { type: 'string' },
                        openTime: { type: 'string' },
                        closeTime: { type: 'string' },
                        isClosed: { type: 'boolean' },
                    },
                },
            },
            categoryConfigurations: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        categoryId: { type: 'string' },
                        isIncluded: { type: 'boolean' },
                        displayOrderOverride: { type: 'number' },
                        customNameOverride: { type: 'string' },
                    },
                },
            },
            status: { type: 'string', enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'PAUSED', 'CLOSED'] },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: { configuration: { type: 'object', properties: eventMenuConfigProperties } },
        },
        500: errorResponse,
    },
};

export const publishEventMenuSchema = {
    description: 'Publish event menu',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
        },
        required: ['vendorId', 'eventId'],
    },
    response: {
        200: {
            type: 'object',
            properties: { configuration: { type: 'object', properties: eventMenuConfigProperties } },
        },
        500: errorResponse,
    },
};

// ==================== TEMPLATE SCHEMAS ====================

export const getTemplatesSchema = {
    description: 'Get all templates for a vendor',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    response: {
        200: {
            type: 'object',
            properties: {
                templates: { type: 'array', items: { type: 'object', properties: templateProperties } },
            },
        },
        500: errorResponse,
    },
};

export const getTemplateSchema = {
    description: 'Get a single template with preview',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            templateId: { type: 'string' },
        },
        required: ['vendorId', 'templateId'],
    },
    response: {
        200: {
            type: 'object',
            properties: {
                template: { type: 'object', properties: templateProperties },
                previewItems: { type: 'array', items: { type: 'object', properties: menuItemProperties } },
                estimatedItemCount: { type: 'number' },
            },
        },
        500: errorResponse,
    },
};

export const createTemplateSchema = {
    description: 'Create a new template',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    body: {
        type: 'object',
        required: ['name', 'templateType'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            templateType: { type: 'string', enum: ['FULL_MENU', 'FESTIVAL', 'CORPORATE', 'QUICK_SERVICE', 'PREMIUM', 'BREAKFAST', 'LUNCH', 'DINNER', 'CUSTOM'] },
            includedCategoryIds: { type: 'array', items: { type: 'string' } },
            includedItemIds: { type: 'array', items: { type: 'string' } },
            excludedItemIds: { type: 'array', items: { type: 'string' } },
            defaultPriceAdjustment: priceAdjustmentSchema,
            defaultPrepTimeAdjustment: { type: 'number' },
            itemOverrides: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        menuItemId: { type: 'string' },
                        priceOverride: { type: 'number' },
                        isIncluded: { type: 'boolean' },
                        displayOrderOverride: { type: 'number' },
                    },
                },
            },
            isDefault: { type: 'boolean' },
        },
    },
    response: {
        201: {
            type: 'object',
            properties: { template: { type: 'object', properties: templateProperties } },
        },
        500: errorResponse,
    },
};

export const updateTemplateSchema = {
    description: 'Update a template',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            templateId: { type: 'string' },
        },
        required: ['vendorId', 'templateId'],
    },
    body: {
        type: 'object',
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            templateType: { type: 'string', enum: ['FULL_MENU', 'FESTIVAL', 'CORPORATE', 'QUICK_SERVICE', 'PREMIUM', 'BREAKFAST', 'LUNCH', 'DINNER', 'CUSTOM'] },
            includedCategoryIds: { type: 'array', items: { type: 'string' } },
            includedItemIds: { type: 'array', items: { type: 'string' } },
            excludedItemIds: { type: 'array', items: { type: 'string' } },
            defaultPriceAdjustment: { oneOf: [priceAdjustmentSchema, { type: 'null' }] },
            defaultPrepTimeAdjustment: { type: ['number', 'null'] },
            itemOverrides: { type: 'array' },
            isDefault: { type: 'boolean' },
            isActive: { type: 'boolean' },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: { template: { type: 'object', properties: templateProperties } },
        },
        500: errorResponse,
    },
};

export const deleteTemplateSchema = {
    description: 'Delete a template',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            templateId: { type: 'string' },
        },
        required: ['vendorId', 'templateId'],
    },
    response: {
        204: { type: 'null' },
        500: errorResponse,
    },
};

export const applyTemplateSchema = {
    description: 'Apply template to an event',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            templateId: { type: 'string' },
        },
        required: ['vendorId', 'templateId'],
    },
    body: {
        type: 'object',
        required: ['eventId'],
        properties: {
            eventId: { type: 'string' },
            overrideExisting: { type: 'boolean', default: false },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: { appliedCount: { type: 'number' } },
        },
        500: errorResponse,
    },
};

// ==================== CATEGORY SCHEMAS ====================

export const getCategoriesSchema = {
    description: 'Get all categories for a vendor',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    response: {
        200: {
            type: 'object',
            properties: {
                categories: { type: 'array', items: { type: 'object', properties: categoryProperties } },
            },
        },
        500: errorResponse,
    },
};

export const createCategorySchema = {
    description: 'Create a new category',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    body: {
        type: 'object',
        required: ['name'],
        properties: {
            parentId: { type: 'string' },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            imageUrl: { type: 'string' },
            displayOrder: { type: 'number' },
            scheduleStart: { type: 'string' },
            scheduleEnd: { type: 'string' },
            availableDays: { type: 'array', items: { type: 'number', minimum: 0, maximum: 6 } },
        },
    },
    response: {
        201: {
            type: 'object',
            properties: { category: { type: 'object', properties: categoryProperties } },
        },
        500: errorResponse,
    },
};

export const updateCategorySchema = {
    description: 'Update a category',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            categoryId: { type: 'string' },
        },
        required: ['vendorId', 'categoryId'],
    },
    body: {
        type: 'object',
        properties: {
            parentId: { type: ['string', 'null'] },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            imageUrl: { type: 'string' },
            displayOrder: { type: 'number' },
            isActive: { type: 'boolean' },
            scheduleStart: { type: ['string', 'null'] },
            scheduleEnd: { type: ['string', 'null'] },
            availableDays: { type: ['array', 'null'], items: { type: 'number' } },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: { category: { type: 'object', properties: categoryProperties } },
        },
        500: errorResponse,
    },
};

export const deleteCategorySchema = {
    description: 'Delete a category',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            categoryId: { type: 'string' },
        },
        required: ['vendorId', 'categoryId'],
    },
    response: {
        204: { type: 'null' },
        400: errorResponse,
        500: errorResponse,
    },
};

export const reorderCategoriesSchema = {
    description: 'Reorder categories',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    body: {
        type: 'object',
        required: ['orders'],
        properties: {
            orders: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['id', 'displayOrder'],
                    properties: {
                        id: { type: 'string' },
                        displayOrder: { type: 'number' },
                    },
                },
            },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: { success: { type: 'boolean' } },
        },
        500: errorResponse,
    },
};

// ==================== MODIFIER SCHEMAS ====================

export const getModifierGroupsSchema = {
    description: 'Get all modifier groups for a vendor',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    response: {
        200: {
            type: 'object',
            properties: {
                modifierGroups: { type: 'array', items: { type: 'object', properties: modifierGroupProperties } },
            },
        },
        500: errorResponse,
    },
};

export const createModifierGroupSchema = {
    description: 'Create a modifier group',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    body: {
        type: 'object',
        required: ['name', 'selectionType'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            selectionType: { type: 'string', enum: ['SINGLE', 'MULTIPLE'] },
            isRequired: { type: 'boolean' },
            minSelections: { type: 'number', minimum: 0 },
            maxSelections: { type: 'number', minimum: 1 },
            displayOrder: { type: 'number' },
        },
    },
    response: {
        201: {
            type: 'object',
            properties: { modifierGroup: { type: 'object', properties: modifierGroupProperties } },
        },
        500: errorResponse,
    },
};

export const addModifierSchema = {
    description: 'Add a modifier to a group',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            groupId: { type: 'string' },
        },
        required: ['vendorId', 'groupId'],
    },
    body: {
        type: 'object',
        required: ['name'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            priceAdjustment: { type: 'number' },
            isDefault: { type: 'boolean' },
            displayOrder: { type: 'number' },
        },
    },
    response: {
        201: {
            type: 'object',
            properties: { modifier: { type: 'object', properties: modifierProperties } },
        },
        500: errorResponse,
    },
};

export const updateModifierGroupSchema = {
    description: 'Update a modifier group',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            groupId: { type: 'string' },
        },
        required: ['vendorId', 'groupId'],
    },
    body: {
        type: 'object',
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            selectionType: { type: 'string', enum: ['SINGLE', 'MULTIPLE'] },
            isRequired: { type: 'boolean' },
            minSelections: { type: 'number', minimum: 0 },
            maxSelections: { type: 'number', minimum: 1 },
            displayOrder: { type: 'number' },
            isActive: { type: 'boolean' },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: { modifierGroup: { type: 'object', properties: modifierGroupProperties } },
        },
        404: errorResponse,
        500: errorResponse,
    },
};

export const deleteModifierGroupSchema = {
    description: 'Delete a modifier group',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            groupId: { type: 'string' },
        },
        required: ['vendorId', 'groupId'],
    },
    response: {
        204: { type: 'null' },
        400: errorResponse,
        500: errorResponse,
    },
};

export const updateModifierSchema = {
    description: 'Update a modifier',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            groupId: { type: 'string' },
            modifierId: { type: 'string' },
        },
        required: ['vendorId', 'groupId', 'modifierId'],
    },
    body: {
        type: 'object',
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            priceAdjustment: { type: 'number' },
            isDefault: { type: 'boolean' },
            isAvailable: { type: 'boolean' },
            displayOrder: { type: 'number' },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: { modifier: { type: 'object', properties: modifierProperties } },
        },
        404: errorResponse,
        500: errorResponse,
    },
};

export const deleteModifierSchema = {
    description: 'Delete a modifier',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            groupId: { type: 'string' },
            modifierId: { type: 'string' },
        },
        required: ['vendorId', 'groupId', 'modifierId'],
    },
    response: {
        204: { type: 'null' },
        500: errorResponse,
    },
};

// ==================== TAG SCHEMAS ====================

export const getTagsSchema = {
    description: 'Get all tags',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    response: {
        200: {
            type: 'object',
            properties: {
                tags: { type: 'array', items: { type: 'object', properties: tagProperties } },
            },
        },
        500: errorResponse,
    },
};

export const createTagSchema = {
    description: 'Create a tag',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    body: {
        type: 'object',
        required: ['name', 'category'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 50 },
            description: { type: 'string', maxLength: 200 },
            color: { type: 'string' },
            icon: { type: 'string' },
            category: { type: 'string', enum: ['DIETARY', 'ALLERGEN', 'SPICE_LEVEL', 'CUISINE', 'PREPARATION', 'FEATURE', 'CUSTOM'] },
        },
    },
    response: {
        201: {
            type: 'object',
            properties: { tag: { type: 'object', properties: tagProperties } },
        },
        500: errorResponse,
    },
};

// ==================== ANALYTICS SCHEMAS ====================

export const getMenuAnalyticsSchema = {
    description: 'Get menu analytics',
    tags: ['vendor-menu'],
    params: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
    },
    querystring: {
        type: 'object',
        properties: {
            eventId: { type: 'string' },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
        },
    },
    response: {
        200: {
            type: 'object',
            properties: {
                summary: {
                    type: 'object',
                    properties: {
                        totalRevenue: { type: 'number' },
                        totalOrders: { type: 'number' },
                        averageOrderValue: { type: 'number' },
                        topSellingItems: { type: 'array' },
                        lowPerformingItems: { type: 'array' },
                    },
                },
                itemAnalytics: { type: 'array' },
                periodStart: { type: 'string' },
                periodEnd: { type: 'string' },
            },
        },
        500: errorResponse,
    },
};

// Get a single vendor menu item by ID
export const getVendorMenuItemSchema = {
    description: 'Get a single vendor menu item by ID',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string', format: 'uuid' },
            itemId: { type: 'string', format: 'uuid' }
        },
        required: ['id', 'itemId']
    },
    response: {
        200: {
            type: 'object',
            properties: {
                menuItem: { type: 'object', properties: menuItemProperties }
            }
        },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        500: { type: 'object', properties: { error: { type: 'string' } } }
    }
};
