/**
 * Vendor Menu Types
 * Industry-standard menu management system supporting:
 * - Default vendor menus (master catalog)
 * - Event-specific menu overrides
 * - Menu templates for quick setup
 * - Pricing tiers and modifiers
 * - Inventory management
 * - Scheduling and availability
 */

// ==================== BASE TYPES ====================

export type MenuItemType = 'FOOD' | 'BEVERAGE' | 'RETAIL' | 'SERVICE';
export type MenuScope = 'DEFAULT' | 'EVENT';
export type PricingStrategy = 'FIXED' | 'TIERED' | 'TIME_BASED' | 'DYNAMIC';
export type AvailabilityStatus = 'AVAILABLE' | 'OUT_OF_STOCK' | 'LIMITED' | 'COMING_SOON' | 'DISCONTINUED';

// ==================== TAG SYSTEM ====================

export interface Tag {
    id: string;
    name: string;
    slug: string;
    description?: string;
    color?: string;
    icon?: string;
    category: TagCategory;
    isActive: boolean;
    createdAt: string;
    updatedAt?: string;
}

export type TagCategory =
    | 'DIETARY'      // Vegan, Vegetarian, Gluten-Free, etc.
    | 'ALLERGEN'     // Contains Nuts, Dairy, etc.
    | 'SPICE_LEVEL'  // Mild, Medium, Hot, Extra Hot
    | 'CUISINE'      // Italian, Mexican, Asian, etc.
    | 'PREPARATION'  // Grilled, Fried, Raw, etc.
    | 'FEATURE'      // Best Seller, New, Chef's Special, etc.
    | 'CUSTOM';

// ==================== MODIFIER SYSTEM ====================

export interface ModifierGroup {
    id: string;
    vendorId: string;
    name: string;
    description?: string;
    selectionType: 'SINGLE' | 'MULTIPLE';
    isRequired: boolean;
    minSelections: number;
    maxSelections: number;
    modifiers: Modifier[];
    displayOrder: number;
    isActive: boolean;
    createdAt: string;
    updatedAt?: string;
}

export interface Modifier {
    id: string;
    groupId: string;
    name: string;
    description?: string;
    priceAdjustment: number; // Can be positive or negative
    isDefault: boolean;
    isAvailable: boolean;
    displayOrder: number;
    nutritionalInfo?: NutritionalInfo;
    createdAt: string;
    updatedAt?: string;
}

// ==================== NUTRITIONAL INFORMATION ====================

export interface NutritionalInfo {
    calories?: number;
    protein?: number;       // grams
    carbohydrates?: number; // grams
    fat?: number;           // grams
    fiber?: number;         // grams
    sugar?: number;         // grams
    sodium?: number;        // milligrams
    servingSize?: string;
    allergens?: string[];
}

// ==================== MENU CATEGORY ====================

export interface MenuCategory {
    id: string;
    vendorId: string;
    parentId?: string;          // For nested categories
    name: string;
    slug: string;
    description?: string;
    imageUrl?: string;
    displayOrder: number;
    isActive: boolean;
    scheduleStart?: string;     // HH:MM - Category only available after this time
    scheduleEnd?: string;       // HH:MM - Category only available before this time
    availableDays?: number[];   // 0-6 for days of week
    createdAt: string;
    updatedAt?: string;
}

// ==================== BASE MENU ITEM ====================

export interface BaseMenuItem {
    id: string;
    vendorId: string;
    categoryId: string;
    sku?: string;               // Stock Keeping Unit
    name: string;
    slug: string;
    description?: string;
    shortDescription?: string;  // For cards/lists
    imageUrl?: string;
    images?: MenuItemImage[];
    type: MenuItemType;

    // Pricing
    basePrice: number;
    costPrice?: number;         // For margin calculations
    pricingStrategy: PricingStrategy;

    // Preparation
    prepTime?: number;          // Minutes
    cookingInstructions?: string;

    // Inventory
    trackInventory: boolean;
    stockQuantity?: number;
    lowStockThreshold?: number;
    availabilityStatus: AvailabilityStatus;

    // Relationships
    tagIds: string[];
    modifierGroupIds: string[];

    // Display
    displayOrder: number;
    isFeatured: boolean;
    isPopular: boolean;
    isAlcohol: boolean;

    // Nutritional
    nutritionalInfo?: NutritionalInfo;

    // Status
    isActive: boolean;

    // Timestamps
    createdAt: string;
    updatedAt?: string;
}

export interface MenuItemImage {
    id: string;
    url: string;
    alt?: string;
    isPrimary: boolean;
    displayOrder: number;
}

// ==================== DEFAULT MENU ITEM ====================

/**
 * Default Menu Item - The master catalog item
 * This is the vendor's standard menu that applies when no event-specific override exists
 */
export interface DefaultMenuItem extends BaseMenuItem {
    scope: 'DEFAULT';
}

// ==================== EVENT MENU ITEM ====================

/**
 * Event Menu Item - Event-specific menu configuration
 * Can override pricing, availability, and other properties from the default menu
 */
export interface EventMenuItem {
    id: string;
    eventId: string;
    vendorId: string;
    defaultMenuItemId: string;  // Reference to the default menu item

    // Override fields (null means use default)
    priceOverride?: number;
    availabilityOverride?: AvailabilityStatus;
    prepTimeOverride?: number;
    stockQuantityOverride?: number;

    // Event-specific settings
    isIncluded: boolean;        // Whether this item is available at this event
    displayOrderOverride?: number;
    isFeaturedAtEvent: boolean;

    // Event-specific limits
    maxOrdersPerCustomer?: number;
    maxTotalOrders?: number;    // Total orders allowed at event
    currentOrderCount: number;  // Track against maxTotalOrders

    // Scheduling within event
    availableFrom?: string;     // ISO datetime
    availableTo?: string;       // ISO datetime

    // Notes
    eventNotes?: string;        // Internal notes for this event

    createdAt: string;
    updatedAt?: string;
}

// ==================== MENU TEMPLATE ====================

/**
 * Menu Template - Reusable menu configurations
 * Vendors can create templates to quickly set up menus for different event types
 */
export interface MenuTemplate {
    id: string;
    vendorId: string;
    name: string;
    description?: string;
    templateType: MenuTemplateType;

    // Template configuration
    includedCategoryIds: string[];
    includedItemIds: string[];
    excludedItemIds: string[];

    // Default overrides for all items in template
    defaultPriceAdjustment?: PriceAdjustment;
    defaultPrepTimeAdjustment?: number; // Add/subtract minutes

    // Item-specific overrides
    itemOverrides: MenuTemplateItemOverride[];

    // Metadata
    isDefault: boolean;         // Is this the vendor's default template?
    usageCount: number;         // How many times used
    lastUsedAt?: string;

    isActive: boolean;
    createdAt: string;
    updatedAt?: string;
}

export type MenuTemplateType =
    | 'FULL_MENU'           // Complete menu
    | 'FESTIVAL'            // Festival/outdoor event optimized
    | 'CORPORATE'           // Corporate catering
    | 'QUICK_SERVICE'       // Fast-moving items only
    | 'PREMIUM'             // High-margin items
    | 'BREAKFAST'           // Time-specific
    | 'LUNCH'               // Time-specific
    | 'DINNER'              // Time-specific
    | 'CUSTOM';             // Custom template

export interface PriceAdjustment {
    type: 'PERCENTAGE' | 'FIXED';
    value: number;          // Percentage (e.g., 10 for 10%) or fixed amount
    direction: 'INCREASE' | 'DECREASE';
}

export interface MenuTemplateItemOverride {
    menuItemId: string;
    priceOverride?: number;
    isIncluded: boolean;
    displayOrderOverride?: number;
}

// ==================== EVENT MENU CONFIGURATION ====================

/**
 * Event Menu Configuration
 * Links a vendor's menu to a specific event with configuration options
 */
export interface EventMenuConfiguration {
    id: string;
    eventId: string;
    vendorId: string;

    // Template used (if any)
    templateId?: string;

    // Menu items for this event
    menuItems: EventMenuItem[];

    // Event-specific categories (can reorder/hide)
    categoryConfigurations: EventCategoryConfiguration[];

    // Payment
    allowPayAtStall: boolean;

    // Global event settings
    isAcceptingOrders: boolean;

    // Capacity management
    maxConcurrentOrders?: number;
    currentActiveOrders: number;
    orderCooldownMinutes?: number;          // Minimum minutes between accepting new orders

    // Customer limits
    maxOrdersPerCustomerEvent?: number;     // Max orders a single customer can place per event

    // Operating hours for this event (HH:MM format, e.g. '10:00' - '22:00')
    eventOpenTime?: string;
    eventCloseTime?: string;
    operatingSchedule?: EventOperatingSchedule[];

    // Pricing & fees
    globalPriceAdjustment?: PriceAdjustment;
    minimumOrderValue?: number;             // Minimum order total required
    serviceFeePercent?: number;             // Service charge added at checkout (%)
    prepTimeBufferMinutes?: number;         // Extra minutes added to all item prep times
    slotDurationMinutes?: number;           // Duration of each pickup time slot (default 30)

    // Operational info visible to customers
    estimatedWaitMinutes?: number;          // Vendor-set wait time shown to customers
    boothInfo?: string;                     // Stand/booth location at venue
    vendorNotice?: string;                  // Custom notice shown before ordering

    // Busy mode
    isBusyMode: boolean;
    busyModeMultiplier: number;

    // Status
    status: EventMenuStatus;
    publishedAt?: string;

    createdAt: string;
    updatedAt?: string;
}

export type EventMenuStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PUBLISHED' | 'PAUSED' | 'CLOSED';

export interface EventCategoryConfiguration {
    categoryId: string;
    isIncluded: boolean;
    displayOrderOverride?: number;
    customNameOverride?: string;
}

export interface EventOperatingSchedule {
    date: string;           // YYYY-MM-DD
    openTime: string;       // HH:MM
    closeTime: string;      // HH:MM
    isClosed: boolean;
}

// ==================== MENU ANALYTICS ====================

export interface MenuItemAnalytics {
    menuItemId: string;
    eventId?: string;       // null for aggregate stats
    periodStart: string;
    periodEnd: string;

    // Sales metrics
    totalOrders: number;
    totalQuantity: number;
    totalRevenue: number;
    averageOrderValue: number;

    // Performance
    conversionRate: number; // Views to orders
    averagePrepTime: number;

    // Customer feedback
    averageRating?: number;
    totalRatings: number;

    // Inventory
    stockouts: number;      // Times item was unavailable
}

// ==================== API REQUEST/RESPONSE TYPES ====================

// Create Default Menu Item
export interface CreateDefaultMenuItemInput {
    categoryId: string;
    sku?: string;
    name: string;
    description?: string;
    shortDescription?: string;
    imageUrl?: string;
    type: MenuItemType;
    basePrice: number;
    costPrice?: number;
    pricingStrategy?: PricingStrategy;
    prepTime?: number;
    trackInventory?: boolean;
    stockQuantity?: number;
    lowStockThreshold?: number;
    tagIds?: string[];
    modifierGroupIds?: string[];
    displayOrder?: number;
    isFeatured?: boolean;
    nutritionalInfo?: NutritionalInfo;
}

export interface UpdateDefaultMenuItemInput {
    categoryId?: string;
    sku?: string;
    name?: string;
    description?: string;
    shortDescription?: string;
    imageUrl?: string;
    type?: MenuItemType;
    basePrice?: number;
    costPrice?: number;
    pricingStrategy?: PricingStrategy;
    prepTime?: number;
    trackInventory?: boolean;
    stockQuantity?: number;
    lowStockThreshold?: number;
    availabilityStatus?: AvailabilityStatus;
    tagIds?: string[];
    modifierGroupIds?: string[];
    displayOrder?: number;
    isFeatured?: boolean;
    isActive?: boolean;
    nutritionalInfo?: NutritionalInfo;
}

// Event Menu Item
export interface CreateEventMenuItemInput {
    eventId: string;
    defaultMenuItemId: string;
    priceOverride?: number;
    availabilityOverride?: AvailabilityStatus;
    prepTimeOverride?: number;
    stockQuantityOverride?: number;
    isIncluded?: boolean;
    displayOrderOverride?: number;
    isFeaturedAtEvent?: boolean;
    maxOrdersPerCustomer?: number;
    maxTotalOrders?: number;
    availableFrom?: string;
    availableTo?: string;
    eventNotes?: string;
}

export interface UpdateEventMenuItemInput {
    priceOverride?: number | null;
    availabilityOverride?: AvailabilityStatus | null;
    prepTimeOverride?: number | null;
    stockQuantityOverride?: number | null;
    isIncluded?: boolean;
    displayOrderOverride?: number | null;
    isFeaturedAtEvent?: boolean;
    maxOrdersPerCustomer?: number | null;
    maxTotalOrders?: number | null;
    availableFrom?: string | null;
    availableTo?: string | null;
    eventNotes?: string | null;
}

// Menu Template
export interface CreateMenuTemplateInput {
    name: string;
    description?: string;
    templateType: MenuTemplateType;
    includedCategoryIds?: string[];
    includedItemIds?: string[];
    excludedItemIds?: string[];
    defaultPriceAdjustment?: PriceAdjustment;
    defaultPrepTimeAdjustment?: number;
    itemOverrides?: MenuTemplateItemOverride[];
    isDefault?: boolean;
}

export interface UpdateMenuTemplateInput {
    name?: string;
    description?: string;
    templateType?: MenuTemplateType;
    includedCategoryIds?: string[];
    includedItemIds?: string[];
    excludedItemIds?: string[];
    defaultPriceAdjustment?: PriceAdjustment | null;
    defaultPrepTimeAdjustment?: number | null;
    itemOverrides?: MenuTemplateItemOverride[];
    isDefault?: boolean;
    isActive?: boolean;
}

// Event Menu Configuration
export interface CreateEventMenuConfigInput {
    eventId: string;
    templateId?: string;
    globalPriceAdjustment?: PriceAdjustment;
    maxConcurrentOrders?: number;
    orderCooldownMinutes?: number;
    maxOrdersPerCustomerEvent?: number;
    eventOpenTime?: string;
    eventCloseTime?: string;
    operatingSchedule?: EventOperatingSchedule[];
    minimumOrderValue?: number;
    serviceFeePercent?: number;
    prepTimeBufferMinutes?: number;
    estimatedWaitMinutes?: number;
    boothInfo?: string;
    vendorNotice?: string;
}

export interface UpdateEventMenuConfigInput {
    templateId?: string | null;
    globalPriceAdjustment?: PriceAdjustment | null;
    isAcceptingOrders?: boolean;
    allowPayAtStall?: boolean;
    maxConcurrentOrders?: number | null;
    orderCooldownMinutes?: number | null;
    maxOrdersPerCustomerEvent?: number | null;
    eventOpenTime?: string | null;
    eventCloseTime?: string | null;
    operatingSchedule?: EventOperatingSchedule[];
    minimumOrderValue?: number | null;
    serviceFeePercent?: number | null;
    prepTimeBufferMinutes?: number | null;
    slotDurationMinutes?: number | null;
    estimatedWaitMinutes?: number | null;
    boothInfo?: string | null;
    vendorNotice?: string | null;
    isBusyMode?: boolean;
    busyModeMultiplier?: number;
    status?: EventMenuStatus;
}

// Apply Template to Event
export interface ApplyTemplateToEventInput {
    eventId: string;
    templateId: string;
    overrideExisting?: boolean;
}

// Bulk Operations
export interface BulkUpdateEventMenuItemsInput {
    eventId: string;
    updates: {
        menuItemId: string;
        changes: UpdateEventMenuItemInput;
    }[];
}

export interface BulkPriceAdjustmentInput {
    eventId: string;
    categoryIds?: string[];     // Apply to specific categories (or all if empty)
    itemIds?: string[];         // Apply to specific items (or all if empty)
    adjustment: PriceAdjustment;
}

// Clone Menu
export interface CloneMenuInput {
    sourceEventId: string;
    targetEventId: string;
    includeOverrides?: boolean;
}

// ==================== RESPONSE TYPES ====================

export interface GetDefaultMenuResponse {
    vendor: {
        id: string;
        name: string;
    };
    categories: MenuCategory[];
    menuItems: DefaultMenuItem[];
    modifierGroups: ModifierGroup[];
    tags: Tag[];
}

export interface GetEventMenuResponse {
    event: {
        id: string;
        name: string;
        startDate: string;
        endDate: string;
    };
    vendor: {
        id: string;
        name: string;
    };
    configuration: EventMenuConfiguration;
    categories: MenuCategory[];
    menuItems: ResolvedEventMenuItem[];
    modifierGroups: ModifierGroup[];
    tags: Tag[];
}

/**
 * Resolved Event Menu Item
 * Combines default menu item with event-specific overrides
 * This is what the frontend receives - already computed final values
 */
export interface ResolvedEventMenuItem extends BaseMenuItem {
    // Event-specific
    eventId: string;
    eventMenuItemId: string;

    // Resolved values (defaults with overrides applied)
    effectivePrice: number;
    effectiveAvailability: AvailabilityStatus;
    effectivePrepTime?: number;
    effectiveStockQuantity?: number;

    // Event-specific properties
    isIncludedInEvent: boolean;
    isFeaturedAtEvent: boolean;
    maxOrdersPerCustomer?: number;
    remainingOrders?: number;   // Based on maxTotalOrders - currentOrderCount
    availableFrom?: string;
    availableTo?: string;

    // Source tracking
    hasEventOverrides: boolean;
    overriddenFields: string[];

    // Discount (populated by discount resolution, undefined if no discount applies)
    discount?: {
        discountId: string;
        type: 'PERCENTAGE' | 'FIXED';
        value: number;
        originalPrice: number;
        discountedPrice: number;
        discountPercentage: number;
        savings: number;
    };
}

export interface MenuTemplateResponse {
    template: MenuTemplate;
    previewItems: DefaultMenuItem[];
    estimatedItemCount: number;
}

export interface MenuAnalyticsResponse {
    summary: {
        totalRevenue: number;
        totalOrders: number;
        averageOrderValue: number;
        topSellingItems: MenuItemAnalytics[];
        lowPerformingItems: MenuItemAnalytics[];
    };
    itemAnalytics: MenuItemAnalytics[];
    periodStart: string;
    periodEnd: string;
}

// ==================== UTILITY TYPES ====================

export type MenuItemWithCategory = DefaultMenuItem & {
    category: MenuCategory;
};

export type EventMenuItemWithDetails = EventMenuItem & {
    defaultItem: DefaultMenuItem;
    category: MenuCategory;
};

export interface MenuComparisonResult {
    itemId: string;
    itemName: string;
    defaultPrice: number;
    eventPrice: number;
    priceDifference: number;
    percentageChange: number;
}

// ==================== VALIDATION TYPES ====================

export interface MenuValidationResult {
    isValid: boolean;
    errors: MenuValidationError[];
    warnings: MenuValidationWarning[];
}

export interface MenuValidationError {
    field: string;
    message: string;
    itemId?: string;
}

export interface MenuValidationWarning {
    field: string;
    message: string;
    itemId?: string;
    suggestion?: string;
}
