/**
 * Vendor Menu Service
 * Comprehensive menu management system supporting:
 * - Default vendor menus (master catalog)
 * - Event-specific menu configurations
 * - Menu templates for quick event setup
 * - Bulk operations and price adjustments
 * - Analytics and reporting
 */

import { supabase } from "../../lib/supabase";
import { cache, CACHE_TTL } from "../../lib/redis";
import { handleDatabaseError, assertExists } from "../../lib/errors";
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
    CreateDefaultMenuItemInput,
    UpdateDefaultMenuItemInput,
    CreateEventMenuItemInput,
    UpdateEventMenuItemInput,
    CreateMenuTemplateInput,
    UpdateMenuTemplateInput,
    CreateEventMenuConfigInput,
    UpdateEventMenuConfigInput,
    ApplyTemplateToEventInput,
    BulkUpdateEventMenuItemsInput,
    BulkPriceAdjustmentInput,
    CloneMenuInput,
    GetDefaultMenuResponse,
    GetEventMenuResponse,
    MenuTemplateResponse,
    MenuAnalyticsResponse,
    MenuValidationResult,
    PriceAdjustment,
    EventCategoryConfiguration,
    MenuItemAnalytics,
} from './vendor-menu.types';
import {
    toDbDefaultMenuItem,
    fromDbDefaultMenuItem,
    toDbEventMenuItem,
    fromDbEventMenuItem,
    toDbMenuCategory,
    fromDbMenuCategory,
    toDbModifierGroup,
    fromDbModifierGroup,
    toDbModifier,
    fromDbModifier,
    toDbTag,
    fromDbTag,
    toDbMenuTemplate,
    fromDbMenuTemplate,
    toDbEventMenuConfig,
    fromDbEventMenuConfig,
    resolveEventMenuItem,
    applyPriceAdjustment,
    validateDefaultMenuItemInput,
    validateEventMenuItemInput,
    generateSlug,
} from './vendor-menu.utils';

// Cache keys
const menuCacheKeys = {
    defaultMenu: (vendorId: string) => `menu:default:${vendorId}`,
    eventMenu: (vendorId: string, eventId: string) => `menu:event:${vendorId}:${eventId}`,
    menuItem: (itemId: string) => `menu:item:${itemId}`,
    categories: (vendorId: string) => `menu:categories:${vendorId}`,
    modifierGroups: (vendorId: string) => `menu:modifiers:${vendorId}`,
    tags: () => 'menu:tags:all',
    template: (templateId: string) => `menu:template:${templateId}`,
    templates: (vendorId: string) => `menu:templates:${vendorId}`,
    eventConfig: (vendorId: string, eventId: string) => `menu:config:${vendorId}:${eventId}`,
    analytics: (vendorId: string, period: string) => `menu:analytics:${vendorId}:${period}`,
} as const;

export class VendorMenuService {

    // ==================== DEFAULT MENU ITEMS ====================

    /**
     * Get complete default menu for a vendor
     */
    async getDefaultMenu(vendorId: string): Promise<GetDefaultMenuResponse> {
        const cacheKey = menuCacheKeys.defaultMenu(vendorId);

        try {
            const cached = await cache.get<GetDefaultMenuResponse>(cacheKey);
            if (cached) {
                console.log(`Cache HIT: getDefaultMenu(${vendorId})`);
                return cached;
            }

            // Fetch vendor info
            const { data: vendor, error: vendorError } = await supabase
                .from('vendors')
                .select('id, name')
                .eq('id', vendorId)
                .single();

            if (vendorError) throw new Error(`Failed to fetch vendor: ${vendorError.message}`);

            // Fetch categories
            const { data: categoriesData } = await supabase
                .from('menu_categories')
                .select('*')
                .eq('vendor_id', vendorId)
                .eq('is_active', true)
                .order('display_order', { ascending: true });

            const categories = (categoriesData || []).map(fromDbMenuCategory);

            // Fetch default menu items
            const { data: itemsData } = await supabase
                .from('default_menu_items')
                .select('*')
                .eq('vendor_id', vendorId)
                .eq('is_active', true)
                .order('display_order', { ascending: true });

            const menuItems = (itemsData || []).map(fromDbDefaultMenuItem);
            const modifierGroups = await this.getVendorModifierGroups(vendorId);
            const tags = await this.getAllTags();

            const response: GetDefaultMenuResponse = {
                vendor: { id: vendor.id, name: vendor.name },
                categories,
                menuItems,
                modifierGroups,
                tags,
            };

            await cache.set(cacheKey, response, CACHE_TTL.MENU_ITEMS);
            return response;
        } catch (error) {
            console.error('Error in getDefaultMenu:', error);
            throw error;
        }
    }

    /**
     * Get a single default menu item
     */
    async getDefaultMenuItem(vendorId: string, itemId: string): Promise<DefaultMenuItem | null> {
        const { data, error } = await supabase
            .from('default_menu_items')
            .select('*')
            .eq('id', itemId)
            .eq('vendor_id', vendorId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new Error(`Failed to fetch menu item: ${error.message}`);
        }

        return data ? fromDbDefaultMenuItem(data) : null;
    }

    /**
     * Create a new default menu item
     */
    async createDefaultMenuItem(vendorId: string, input: CreateDefaultMenuItemInput): Promise<DefaultMenuItem> {
        const validation = validateDefaultMenuItemInput(input);
        if (!validation.isValid) {
            throw new Error(`Validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
        }

        const dbItem = toDbDefaultMenuItem({
            vendorId,
            slug: generateSlug(input.name),
            scope: 'DEFAULT',
            availabilityStatus: 'AVAILABLE',
            trackInventory: input.trackInventory ?? false,
            pricingStrategy: input.pricingStrategy ?? 'FIXED',
            displayOrder: input.displayOrder ?? 0,
            isFeatured: input.isFeatured ?? false,
            isPopular: false,
            isActive: true,
            ...input,
        });

        const { data, error } = await supabase
            .from('default_menu_items')
            .insert([dbItem])
            .select()
            .single();

        if (error) throw new Error(`Failed to create menu item: ${error.message}`);

        await this.invalidateMenuCaches(vendorId);
        return fromDbDefaultMenuItem(data);
    }

    /**
     * Update a default menu item
     */
    async updateDefaultMenuItem(vendorId: string, itemId: string, input: UpdateDefaultMenuItemInput): Promise<DefaultMenuItem> {
        const dbItem = toDbDefaultMenuItem(input);
        if (input.name) dbItem.slug = generateSlug(input.name);

        const { data, error } = await supabase
            .from('default_menu_items')
            .update(dbItem)
            .eq('id', itemId)
            .eq('vendor_id', vendorId)
            .select()
            .single();

        if (error) throw new Error(`Failed to update menu item: ${error.message}`);

        await this.invalidateMenuCaches(vendorId);
        return fromDbDefaultMenuItem(data);
    }

    /**
     * Delete a default menu item
     */
    async deleteDefaultMenuItem(vendorId: string, itemId: string): Promise<void> {
        const { data: eventItems } = await supabase
            .from('event_menu_items')
            .select('id')
            .eq('default_menu_item_id', itemId)
            .limit(1);

        if (eventItems && eventItems.length > 0) {
            await supabase
                .from('default_menu_items')
                .update({ is_active: false })
                .eq('id', itemId)
                .eq('vendor_id', vendorId);
        } else {
            const { error } = await supabase
                .from('default_menu_items')
                .delete()
                .eq('id', itemId)
                .eq('vendor_id', vendorId);

            if (error) throw new Error(`Failed to delete menu item: ${error.message}`);
        }

        await this.invalidateMenuCaches(vendorId);
    }

    /**
     * Bulk create default menu items
     */
    async bulkCreateDefaultMenuItems(vendorId: string, items: CreateDefaultMenuItemInput[]): Promise<DefaultMenuItem[]> {
        const dbItems = items.map((input, index) => {
            const validation = validateDefaultMenuItemInput(input);
            if (!validation.isValid) {
                throw new Error(`Item ${index + 1} validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
            }

            return toDbDefaultMenuItem({
                vendorId,
                slug: generateSlug(input.name),
                scope: 'DEFAULT',
                availabilityStatus: 'AVAILABLE',
                trackInventory: input.trackInventory ?? false,
                pricingStrategy: input.pricingStrategy ?? 'FIXED',
                displayOrder: input.displayOrder ?? index,
                isFeatured: input.isFeatured ?? false,
                isPopular: false,
                isActive: true,
                ...input,
            });
        });

        const { data, error } = await supabase
            .from('default_menu_items')
            .insert(dbItems)
            .select();

        if (error) throw new Error(`Failed to bulk create menu items: ${error.message}`);

        await this.invalidateMenuCaches(vendorId);
        return (data || []).map(fromDbDefaultMenuItem);
    }

    // ==================== EVENT MENU ITEMS ====================

    /**
     * Get complete event menu for a vendor at a specific event
     */
    async getEventMenu(vendorId: string, eventId: string): Promise<GetEventMenuResponse> {
        const cacheKey = menuCacheKeys.eventMenu(vendorId, eventId);

        try {
            const cached = await cache.get<GetEventMenuResponse>(cacheKey);
            if (cached) return cached;

            // Fetch event and vendor info
            const { data: event } = await supabase
                .from('events')
                .select('id, name, start_date, end_date')
                .eq('id', eventId)
                .single();

            const { data: vendor } = await supabase
                .from('vendors')
                .select('id, name')
                .eq('id', vendorId)
                .single();

            if (!event || !vendor) throw new Error('Event or vendor not found');

            const configuration = await this.getOrCreateEventMenuConfig(vendorId, eventId);

            // Fetch categories with configurations
            const { data: categoriesData } = await supabase
                .from('menu_categories')
                .select('*')
                .eq('vendor_id', vendorId)
                .eq('is_active', true)
                .order('display_order', { ascending: true });

            const categories = (categoriesData || []).map(fromDbMenuCategory);
            const categoryConfigs = new Map(configuration.categoryConfigurations.map(c => [c.categoryId, c]));

            const filteredCategories = categories
                .filter(cat => {
                    const config = categoryConfigs.get(cat.id);
                    return !config || config.isIncluded !== false;
                })
                .map(cat => {
                    const config = categoryConfigs.get(cat.id);
                    return {
                        ...cat,
                        displayOrder: config?.displayOrderOverride ?? cat.displayOrder,
                        name: config?.customNameOverride ?? cat.name,
                    };
                })
                .sort((a, b) => a.displayOrder - b.displayOrder);

            // Fetch and resolve menu items
            const { data: defaultItemsData } = await supabase
                .from('default_menu_items')
                .select('*')
                .eq('vendor_id', vendorId)
                .eq('is_active', true);

            const { data: eventItemsData } = await supabase
                .from('event_menu_items')
                .select('*')
                .eq('vendor_id', vendorId)
                .eq('event_id', eventId);

            const defaultItems = (defaultItemsData || []).map(fromDbDefaultMenuItem);
            const eventItems = (eventItemsData || []).map(fromDbEventMenuItem);
            const eventItemMap = new Map(eventItems.map(ei => [ei.defaultMenuItemId, ei]));

            const resolvedItems: ResolvedEventMenuItem[] = [];

            for (const defaultItem of defaultItems) {
                let eventItem = eventItemMap.get(defaultItem.id);

                if (!eventItem) {
                    eventItem = {
                        id: `virtual-${defaultItem.id}`,
                        eventId,
                        vendorId,
                        defaultMenuItemId: defaultItem.id,
                        isIncluded: true,
                        isFeaturedAtEvent: false,
                        currentOrderCount: 0,
                        createdAt: new Date().toISOString(),
                    };
                }

                if (!eventItem.isIncluded) continue;

                let resolvedItem = resolveEventMenuItem(defaultItem, eventItem);

                if (configuration.globalPriceAdjustment) {
                    resolvedItem = {
                        ...resolvedItem,
                        effectivePrice: applyPriceAdjustment(resolvedItem.effectivePrice, configuration.globalPriceAdjustment),
                    };
                }

                resolvedItems.push(resolvedItem);
            }

            resolvedItems.sort((a, b) => a.displayOrder - b.displayOrder);

            const modifierGroups = await this.getVendorModifierGroups(vendorId);
            const tags = await this.getAllTags();

            const response: GetEventMenuResponse = {
                event: { id: event.id, name: event.name, startDate: event.start_date, endDate: event.end_date },
                vendor: { id: vendor.id, name: vendor.name },
                configuration,
                categories: filteredCategories,
                menuItems: resolvedItems,
                modifierGroups,
                tags,
            };

            await cache.set(cacheKey, response, CACHE_TTL.MENU_ITEMS);
            return response;
        } catch (error) {
            console.error('Error in getEventMenu:', error);
            throw error;
        }
    }

    /**
     * Get a single event menu item by ID with full details
     */
    async getEventMenuItem(vendorId: string, eventId: string, eventMenuItemId: string): Promise<ResolvedEventMenuItem> {
        console.log('[GET EVENT MENU ITEM] Fetching:', { vendorId, eventId, eventMenuItemId });

        // Fetch the event menu item with its default item details
        const { data, error } = await supabase
            .from('event_menu_items')
            .select(`
                *,
                default_menu_items (
                    *,
                    menu_categories (*)
                )
            `)
            .eq('id', eventMenuItemId)
            .eq('vendor_id', vendorId)
            .eq('event_id', eventId)
            .single();

        if (error) {
            handleDatabaseError('fetch event menu item', error, { vendorId, eventId, eventMenuItemId });
        }

        assertExists(data, 'Event menu item not found', { eventMenuItemId, eventId });

        // Convert to resolved event menu item format
        const eventItem = fromDbEventMenuItem(data);
        const defaultItem = fromDbDefaultMenuItem(data.default_menu_items);

        const resolved = resolveEventMenuItem(defaultItem, eventItem);

        console.log('[GET EVENT MENU ITEM] Found:', { itemName: resolved.name, effectivePrice: resolved.effectivePrice });

        return resolved;
    }

    /**
     * Create or update event menu item override
     */
    async upsertEventMenuItem(vendorId: string, eventId: string, input: CreateEventMenuItemInput): Promise<EventMenuItem> {
        const { data: existing } = await supabase
            .from('event_menu_items')
            .select('id')
            .eq('event_id', eventId)
            .eq('vendor_id', vendorId)
            .eq('default_menu_item_id', input.defaultMenuItemId)
            .single();

        const dbItem = toDbEventMenuItem({
            ...input,
            eventId,
            vendorId,
            isIncluded: input.isIncluded ?? true,
            isFeaturedAtEvent: input.isFeaturedAtEvent ?? false,
            currentOrderCount: 0,
        });

        let data, error;

        if (existing) {
            ({ data, error } = await supabase
                .from('event_menu_items')
                .update(dbItem)
                .eq('id', existing.id)
                .select()
                .single());
        } else {
            ({ data, error } = await supabase
                .from('event_menu_items')
                .insert([dbItem])
                .select()
                .single());
        }

        if (error) throw new Error(`Failed to upsert event menu item: ${error.message}`);

        await this.invalidateEventMenuCaches(vendorId, eventId);
        return fromDbEventMenuItem(data);
    }

    /**
     * Update an existing event menu item by its ID
     */
    async updateEventMenuItem(
        vendorId: string,
        eventId: string,
        eventItemId: string,
        input: UpdateEventMenuItemInput
    ): Promise<EventMenuItem> {
        const dbItem = toDbEventMenuItem(input as Partial<EventMenuItem>);

        const { data, error } = await supabase
            .from('event_menu_items')
            .update(dbItem)
            .eq('id', eventItemId)
            .eq('vendor_id', vendorId)
            .eq('event_id', eventId)
            .select()
            .single();

        if (error) throw new Error(`Failed to update event menu item: ${error.message}`);

        await this.invalidateEventMenuCaches(vendorId, eventId);
        return fromDbEventMenuItem(data);
    }

    /**
     * Bulk update event menu items
     */
    async bulkUpdateEventMenuItems(vendorId: string, input: BulkUpdateEventMenuItemsInput): Promise<EventMenuItem[]> {
        const results: EventMenuItem[] = [];

        for (const update of input.updates) {
            const dbItem = toDbEventMenuItem(update.changes as Partial<EventMenuItem>);

            const { data, error } = await supabase
                .from('event_menu_items')
                .update(dbItem)
                .eq('default_menu_item_id', update.menuItemId)
                .eq('vendor_id', vendorId)
                .eq('event_id', input.eventId)
                .select()
                .single();

            if (!error && data) results.push(fromDbEventMenuItem(data));
        }

        await this.invalidateEventMenuCaches(vendorId, input.eventId);
        return results;
    }

    /**
     * Apply bulk price adjustment
     */
    async bulkPriceAdjustment(vendorId: string, input: BulkPriceAdjustmentInput): Promise<{ updatedCount: number }> {
        let query = supabase
            .from('default_menu_items')
            .select('id, base_price')
            .eq('vendor_id', vendorId)
            .eq('is_active', true);

        if (input.categoryIds?.length) query = query.in('category_id', input.categoryIds);
        if (input.itemIds?.length) query = query.in('id', input.itemIds);

        const { data: items } = await query;
        if (!items?.length) return { updatedCount: 0 };

        let updatedCount = 0;

        for (const item of items) {
            const adjustedPrice = applyPriceAdjustment(item.base_price, input.adjustment);

            const { error } = await supabase
                .from('event_menu_items')
                .upsert({
                    event_id: input.eventId,
                    vendor_id: vendorId,
                    default_menu_item_id: item.id,
                    price_override: adjustedPrice,
                    is_included: true,
                }, { onConflict: 'event_id,vendor_id,default_menu_item_id' });

            if (!error) updatedCount++;
        }

        await this.invalidateEventMenuCaches(vendorId, input.eventId);
        return { updatedCount };
    }

    /**
     * Reset event menu prices to defaults
     * Sets all price_override to null AND removes globalPriceAdjustment from config
     * so items use their original default menu prices with no modifications
     */
    async resetEventMenuPrices(vendorId: string, eventId: string): Promise<{ resetCount: number }> {
        console.log('[RESET PRICES] Starting reset for event:', { vendorId, eventId });

        // Step 1: Remove price overrides from individual items
        const { data, error } = await supabase
            .from('event_menu_items')
            .update({ price_override: null })
            .eq('vendor_id', vendorId)
            .eq('event_id', eventId)
            .select('id');

        if (error) {
            handleDatabaseError('reset event menu item prices', error, { vendorId, eventId });
        }

        const resetCount = data?.length || 0;
        console.log('[RESET PRICES] Individual item overrides reset:', { resetCount });

        // Step 2: Remove global price adjustment from event config
        const { error: configError } = await supabase
            .from('event_menu_configurations')
            .update({ global_price_adjustment: null })
            .eq('vendor_id', vendorId)
            .eq('event_id', eventId);

        if (configError) {
            handleDatabaseError('reset global price adjustment', configError, { vendorId, eventId });
        }

        console.log('[RESET PRICES] Global price adjustment removed');
        console.log('[RESET PRICES] Reset complete:', { totalItemsReset: resetCount });

        // Invalidate caches
        await this.invalidateEventMenuCaches(vendorId, eventId);

        return { resetCount };
    }

    /**
     * Clone menu from one event to another
     */
    async cloneEventMenu(vendorId: string, input: CloneMenuInput): Promise<{ clonedCount: number }> {
        const { data: sourceItems } = await supabase
            .from('event_menu_items')
            .select('*')
            .eq('vendor_id', vendorId)
            .eq('event_id', input.sourceEventId);

        if (!sourceItems?.length) return { clonedCount: 0 };

        const targetItems = sourceItems.map(item => ({
            ...item,
            id: undefined,
            event_id: input.targetEventId,
            current_order_count: 0,
            created_at: new Date().toISOString(),
            updated_at: undefined,
        }));

        if (!input.includeOverrides) {
            const { data: existingItems } = await supabase
                .from('event_menu_items')
                .select('default_menu_item_id')
                .eq('vendor_id', vendorId)
                .eq('event_id', input.targetEventId);

            const existingIds = new Set((existingItems || []).map(i => i.default_menu_item_id));
            const newItems = targetItems.filter(i => !existingIds.has(i.default_menu_item_id));

            if (!newItems.length) return { clonedCount: 0 };

            const { data } = await supabase.from('event_menu_items').insert(newItems).select();
            await this.invalidateEventMenuCaches(vendorId, input.targetEventId);
            return { clonedCount: data?.length || 0 };
        }

        let clonedCount = 0;
        for (const item of targetItems) {
            const { error } = await supabase
                .from('event_menu_items')
                .upsert(item, { onConflict: 'event_id,vendor_id,default_menu_item_id' });
            if (!error) clonedCount++;
        }

        await this.invalidateEventMenuCaches(vendorId, input.targetEventId);
        return { clonedCount };
    }

    // ==================== EVENT MENU CONFIGURATION ====================

    async getOrCreateEventMenuConfig(vendorId: string, eventId: string): Promise<EventMenuConfiguration> {
        const { data, error } = await supabase
            .from('event_menu_configurations')
            .select('*')
            .eq('vendor_id', vendorId)
            .eq('event_id', eventId)
            .single();

        if (data) {
            const { data: eventItems } = await supabase
                .from('event_menu_items')
                .select('*')
                .eq('vendor_id', vendorId)
                .eq('event_id', eventId);

            return fromDbEventMenuConfig(data, (eventItems || []).map(fromDbEventMenuItem));
        }

        const defaultConfig = {
            event_id: eventId,
            vendor_id: vendorId,
            is_accepting_orders: true,
            current_active_orders: 0,
            status: 'DRAFT',
            category_configurations: [],
        };

        const { data: newConfig, error: createError } = await supabase
            .from('event_menu_configurations')
            .insert([defaultConfig])
            .select()
            .single();

        if (createError) throw new Error(`Failed to create event config: ${createError.message}`);

        return fromDbEventMenuConfig(newConfig, []);
    }

    async updateEventMenuConfig(vendorId: string, eventId: string, input: UpdateEventMenuConfigInput): Promise<EventMenuConfiguration> {
        const dbConfig = toDbEventMenuConfig(input as Partial<EventMenuConfiguration>);

        const { data, error } = await supabase
            .from('event_menu_configurations')
            .update(dbConfig)
            .eq('vendor_id', vendorId)
            .eq('event_id', eventId)
            .select()
            .single();

        if (error) throw new Error(`Failed to update event config: ${error.message}`);

        const { data: eventItems } = await supabase
            .from('event_menu_items')
            .select('*')
            .eq('vendor_id', vendorId)
            .eq('event_id', eventId);

        await this.invalidateEventMenuCaches(vendorId, eventId);
        return fromDbEventMenuConfig(data, (eventItems || []).map(fromDbEventMenuItem));
    }

    async publishEventMenu(vendorId: string, eventId: string): Promise<EventMenuConfiguration> {
        return this.updateEventMenuConfig(vendorId, eventId, { status: 'PUBLISHED' });
    }

    // ==================== MENU TEMPLATES ====================

    async getVendorTemplates(vendorId: string): Promise<MenuTemplate[]> {
        const { data } = await supabase
            .from('menu_templates')
            .select('*')
            .eq('vendor_id', vendorId)
            .eq('is_active', true)
            .order('is_default', { ascending: false })
            .order('usage_count', { ascending: false });

        return (data || []).map(fromDbMenuTemplate);
    }

    async getTemplate(vendorId: string, templateId: string): Promise<MenuTemplateResponse> {
        const { data, error } = await supabase
            .from('menu_templates')
            .select('*')
            .eq('id', templateId)
            .eq('vendor_id', vendorId)
            .single();

        if (error) throw new Error(`Failed to fetch template: ${error.message}`);

        const template = fromDbMenuTemplate(data);

        let itemQuery = supabase
            .from('default_menu_items')
            .select('*')
            .eq('vendor_id', vendorId)
            .eq('is_active', true);

        if (template.includedCategoryIds.length) {
            itemQuery = itemQuery.in('category_id', template.includedCategoryIds);
        }

        if (template.includedItemIds.length) {
            itemQuery = itemQuery.in('id', template.includedItemIds);
        }

        const { data: itemsData } = await itemQuery;
        let previewItems = (itemsData || []).map(fromDbDefaultMenuItem);

        if (template.excludedItemIds.length) {
            previewItems = previewItems.filter(item => !template.excludedItemIds.includes(item.id));
        }

        return { template, previewItems, estimatedItemCount: previewItems.length };
    }

    async createTemplate(vendorId: string, input: CreateMenuTemplateInput): Promise<MenuTemplate> {
        if (input.isDefault) {
            await supabase
                .from('menu_templates')
                .update({ is_default: false })
                .eq('vendor_id', vendorId);
        }

        const dbTemplate = toDbMenuTemplate({ vendorId, usageCount: 0, isActive: true, ...input });

        const { data, error } = await supabase
            .from('menu_templates')
            .insert([dbTemplate])
            .select()
            .single();

        if (error) throw new Error(`Failed to create template: ${error.message}`);

        return fromDbMenuTemplate(data);
    }

    async updateTemplate(vendorId: string, templateId: string, input: Partial<MenuTemplate>): Promise<MenuTemplate> {
        // If setting as default, clear other defaults first
        if (input.isDefault) {
            await supabase
                .from('menu_templates')
                .update({ is_default: false })
                .eq('vendor_id', vendorId);
        }

        const dbTemplate = toDbMenuTemplate(input);

        const { data, error } = await supabase
            .from('menu_templates')
            .update(dbTemplate)
            .eq('id', templateId)
            .eq('vendor_id', vendorId)
            .select()
            .single();

        if (error) throw new Error(`Failed to update template: ${error.message}`);

        return fromDbMenuTemplate(data);
    }

    async deleteTemplate(vendorId: string, templateId: string): Promise<void> {
        const { error } = await supabase
            .from('menu_templates')
            .delete()
            .eq('id', templateId)
            .eq('vendor_id', vendorId);

        if (error) throw new Error(`Failed to delete template: ${error.message}`);
    }

    async applyTemplateToEvent(vendorId: string, input: ApplyTemplateToEventInput): Promise<{ appliedCount: number }> {
        const templateResponse = await this.getTemplate(vendorId, input.templateId);
        const template = templateResponse.template;

        if (input.overrideExisting) {
         await supabase
                .from('event_menu_items')
                .delete()
                .eq('vendor_id', vendorId)
                .eq('event_id', input.eventId);
        }

        const { data: itemsData } = await supabase
            .from('default_menu_items')
            .select('*')
            .eq('vendor_id', vendorId)
            .eq('is_active', true);

        let items = (itemsData || []).map(fromDbDefaultMenuItem);

        if (template.includedCategoryIds.length) {
            items = items.filter(item => template.includedCategoryIds.includes(item.categoryId));
        }

        if (template.includedItemIds.length) {
            items = items.filter(item => template.includedItemIds.includes(item.id));
        }

        if (template.excludedItemIds.length) {
            items = items.filter(item => !template.excludedItemIds.includes(item.id));
        }

        const eventMenuItems = items.map(item => {
            const itemOverride = template.itemOverrides.find(o => o.menuItemId === item.id);
            let priceOverride: number | undefined;

            if (template.defaultPriceAdjustment) {
                priceOverride = applyPriceAdjustment(item.basePrice, template.defaultPriceAdjustment);
            }

            if (itemOverride?.priceOverride !== undefined) {
                priceOverride = itemOverride.priceOverride;
            }

            return {
                event_id: input.eventId,
                vendor_id: vendorId,
                default_menu_item_id: item.id,
                price_override: priceOverride,
                prep_time_override: template.defaultPrepTimeAdjustment
                    ? (item.prepTime || 0) + template.defaultPrepTimeAdjustment
                    : undefined,
                is_included: itemOverride?.isIncluded ?? true,
                display_order_override: itemOverride?.displayOrderOverride,
                is_featured_at_event: false,
                current_order_count: 0,
            };
        });

        const { data: inserted } = await supabase
            .from('event_menu_items')
            .insert(eventMenuItems)
            .select();

        await supabase
            .from('menu_templates')
            .update({ usage_count: template.usageCount + 1, last_used_at: new Date().toISOString() })
            .eq('id', template.id);

        await this.invalidateEventMenuCaches(vendorId, input.eventId);

        return { appliedCount: inserted?.length || 0 };
    }

    // ==================== CATEGORIES ====================

    async getVendorCategories(vendorId: string): Promise<MenuCategory[]> {
        const { data } = await supabase
            .from('menu_categories')
            .select('*')
            .eq('vendor_id', vendorId)
            .eq('is_active', true)
            .order('display_order', { ascending: true });

        return (data || []).map(fromDbMenuCategory);
    }

    async createCategory(vendorId: string, input: Omit<MenuCategory, 'id' | 'vendorId' | 'createdAt' | 'updatedAt'>): Promise<MenuCategory> {
        const dbCategory = toDbMenuCategory({ ...input, vendorId, slug: generateSlug(input.name), isActive: true });

        const { data, error } = await supabase
            .from('menu_categories')
            .insert([dbCategory])
            .select()
            .single();

        if (error) throw new Error(`Failed to create category: ${error.message}`);

        await this.invalidateMenuCaches(vendorId);
        return fromDbMenuCategory(data);
    }

    async updateCategory(vendorId: string, categoryId: string, input: Partial<MenuCategory>): Promise<MenuCategory> {
        const dbCategory = toDbMenuCategory(input);
        if (input.name) dbCategory.slug = generateSlug(input.name);

        const { data, error } = await supabase
            .from('menu_categories')
            .update(dbCategory)
            .eq('id', categoryId)
            .eq('vendor_id', vendorId)
            .select()
            .single();

        if (error) throw new Error(`Failed to update category: ${error.message}`);

        await this.invalidateMenuCaches(vendorId);
        return fromDbMenuCategory(data);
    }

    async deleteCategory(vendorId: string, categoryId: string): Promise<void> {
        const { data: items } = await supabase
            .from('default_menu_items')
            .select('id')
            .eq('category_id', categoryId)
            .limit(1);

        if (items?.length) {
            throw new Error('Cannot delete category with existing menu items');
        }

        await supabase.from('menu_categories').delete().eq('id', categoryId).eq('vendor_id', vendorId);
        await this.invalidateMenuCaches(vendorId);
    }

    async reorderCategories(vendorId: string, orders: { id: string; displayOrder: number }[]): Promise<void> {
        for (const order of orders) {
            await supabase
                .from('menu_categories')
                .update({ display_order: order.displayOrder })
                .eq('id', order.id)
                .eq('vendor_id', vendorId);
        }

        await this.invalidateMenuCaches(vendorId);
    }

    // ==================== MODIFIER GROUPS ====================

    async getVendorModifierGroups(vendorId: string): Promise<ModifierGroup[]> {
        console.log('Fetching modifier groups for vendor:', vendorId);
        console.log('Fetching modifier groups for vendor:', vendorId);

        // First, let's see ALL modifier groups in the table (no filters)
        const { data: allGroups, error: allError } = await supabase
            .from('modifier_groups')
            .select('*');

        console.log('ALL modifier groups in table:', JSON.stringify(allGroups, null, 2));
        console.log('All groups error:', allError);

        const { data: groupsData, error: groupsError } = await supabase
            .from('modifier_groups')
            .select('*')
            .eq('vendor_id', vendorId)
            .eq('is_active', true)
            .order('display_order', { ascending: true });

        console.log('Groups query result:', { groupsData, groupsError });

        const groupIds = (groupsData || []).map(g => g.id);

        const { data: modifiersData } = await supabase
            .from('modifiers')
            .select('*')
            .in('group_id', groupIds)
            .eq('is_available', true)
            .order('display_order', { ascending: true });

        const modifiers = (modifiersData || []).map(fromDbModifier);
        const modifiersByGroup = new Map<string, Modifier[]>();

        for (const mod of modifiers) {
            const existing = modifiersByGroup.get(mod.groupId) || [];
            existing.push(mod);
            modifiersByGroup.set(mod.groupId, existing);
        }

        return (groupsData || []).map(g => fromDbModifierGroup(g, modifiersByGroup.get(g.id) || []));
    }

    async createModifierGroup(vendorId: string, input: Omit<ModifierGroup, 'id' | 'vendorId' | 'modifiers' | 'createdAt' | 'updatedAt'>): Promise<ModifierGroup> {
        const dbGroup = toDbModifierGroup({ ...input, vendorId, isActive: true });

        const { data, error } = await supabase
            .from('modifier_groups')
            .insert([dbGroup])
            .select()
            .single();

        if (error) throw new Error(`Failed to create modifier group: ${error.message}`);

        return fromDbModifierGroup(data, []);
    }

    async addModifier(vendorId: string, groupId: string, input: Omit<Modifier, 'id' | 'groupId' | 'createdAt' | 'updatedAt'>): Promise<Modifier> {
        const { data: group } = await supabase
            .from('modifier_groups')
            .select('id')
            .eq('id', groupId)
            .eq('vendor_id', vendorId)
            .single();

        if (!group) throw new Error('Modifier group not found');

        const dbModifier = toDbModifier({ ...input, groupId, isAvailable: true });

        const { data, error } = await supabase
            .from('modifiers')
            .insert([dbModifier])
            .select()
            .single();

        if (error) throw new Error(`Failed to add modifier: ${error.message}`);

        return fromDbModifier(data);
    }

    async updateModifierGroup(vendorId: string, groupId: string, input: Partial<ModifierGroup>): Promise<ModifierGroup> {
        const dbGroup = toDbModifierGroup(input);

        const { data, error } = await supabase
            .from('modifier_groups')
            .update(dbGroup)
            .eq('id', groupId)
            .eq('vendor_id', vendorId)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                throw new Error('Modifier group not found');
            }
            throw new Error(`Failed to update modifier group: ${error.message}`);
        }

        await this.invalidateMenuCaches(vendorId);
        return fromDbModifierGroup(data, []);
    }

    async deleteModifierGroup(vendorId: string, groupId: string): Promise<void> {
        const { data: modifiers } = await supabase
            .from('modifiers')
            .select('id')
            .eq('group_id', groupId)
            .limit(1);

        if (modifiers && modifiers.length > 0) {
            throw new Error('Cannot delete modifier group with existing modifiers');
        }

        const { error } = await supabase
            .from('modifier_groups')
            .delete()
            .eq('id', groupId)
            .eq('vendor_id', vendorId);

        if (error) throw new Error(`Failed to delete modifier group: ${error.message}`);

        await this.invalidateMenuCaches(vendorId);
    }

    async updateModifier(vendorId: string, groupId: string, modifierId: string, input: Partial<Modifier>): Promise<Modifier> {
        const { data: group } = await supabase
            .from('modifier_groups')
            .select('id')
            .eq('id', groupId)
            .eq('vendor_id', vendorId)
            .single();

        if (!group) throw new Error('Modifier group not found');

        const dbModifier = toDbModifier(input);

        const { data, error } = await supabase
            .from('modifiers')
            .update(dbModifier)
            .eq('id', modifierId)
            .eq('group_id', groupId)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                throw new Error('Modifier not found');
            }
            throw new Error(`Failed to update modifier: ${error.message}`);
        }

        await this.invalidateMenuCaches(vendorId);
        return fromDbModifier(data);
    }

    async deleteModifier(vendorId: string, groupId: string, modifierId: string): Promise<void> {
        const { data: group } = await supabase
            .from('modifier_groups')
            .select('id')
            .eq('id', groupId)
            .eq('vendor_id', vendorId)
            .single();

        if (!group) throw new Error('Modifier group not found');

        const { error } = await supabase
            .from('modifiers')
            .delete()
            .eq('id', modifierId)
            .eq('group_id', groupId);

        if (error) throw new Error(`Failed to delete modifier: ${error.message}`);

        await this.invalidateMenuCaches(vendorId);
    }

    // ==================== TAGS ====================

    async getAllTags(): Promise<Tag[]> {
        const { data } = await supabase
            .from('menu_tags')
            .select('*')
            .eq('is_active', true)
            .order('category', { ascending: true })
            .order('name', { ascending: true });

        return (data || []).map(fromDbTag);
    }

    async createTag(input: Omit<Tag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tag> {
        const dbTag = toDbTag({ ...input, slug: generateSlug(input.name), isActive: true });

        const { data, error } = await supabase
            .from('menu_tags')
            .insert([dbTag])
            .select()
            .single();

        if (error) throw new Error(`Failed to create tag: ${error.message}`);

        return fromDbTag(data);
    }

    // ==================== ANALYTICS ====================

    async getMenuAnalytics(vendorId: string, eventId?: string, startDate?: string, endDate?: string): Promise<MenuAnalyticsResponse> {
        let query = supabase.from('orders').select('*').eq('vendor_id', vendorId);

        if (eventId) query = query.eq('event_id', eventId);
        if (startDate) query = query.gte('created_at', startDate);
        if (endDate) query = query.lte('created_at', endDate);

        const { data: orders } = await query;

        const itemStats = new Map<string, MenuItemAnalytics>();

        for (const order of orders || []) {
            for (const item of order.items || []) {
                const existing = itemStats.get(item.id) || {
                    menuItemId: item.id,
                    eventId,
                    periodStart: startDate || '',
                    periodEnd: endDate || new Date().toISOString(),
                    totalOrders: 0,
                    totalQuantity: 0,
                    totalRevenue: 0,
                    averageOrderValue: 0,
                    conversionRate: 0,
                    averagePrepTime: 0,
                    totalRatings: 0,
                    stockouts: 0,
                };

                existing.totalOrders += 1;
                existing.totalQuantity += item.quantity || 1;
                existing.totalRevenue += (item.price || 0) * (item.quantity || 1);

                itemStats.set(item.id, existing);
            }
        }

        const itemAnalytics = Array.from(itemStats.values()).map(stats => ({
            ...stats,
            averageOrderValue: stats.totalOrders > 0 ? stats.totalRevenue / stats.totalOrders : 0,
        }));

        const sortedByRevenue = [...itemAnalytics].sort((a, b) => b.totalRevenue - a.totalRevenue);
        const totalRevenue = itemAnalytics.reduce((sum, i) => sum + i.totalRevenue, 0);
        const totalOrders = orders?.length || 0;

        return {
            summary: {
                totalRevenue,
                totalOrders,
                averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
                topSellingItems: sortedByRevenue.slice(0, 5),
                lowPerformingItems: sortedByRevenue.slice(-5).reverse(),
            },
            itemAnalytics,
            periodStart: startDate || '',
            periodEnd: endDate || new Date().toISOString(),
        };
    }

    // ==================== CACHE INVALIDATION ====================

    private async invalidateMenuCaches(vendorId: string): Promise<void> {
        try {
            await cache.del(
                menuCacheKeys.defaultMenu(vendorId),
                menuCacheKeys.categories(vendorId),
                menuCacheKeys.modifierGroups(vendorId),
                menuCacheKeys.templates(vendorId)
            );
        } catch (error) {
            console.error('Error invalidating menu caches:', error);
        }
    }

    private async invalidateEventMenuCaches(vendorId: string, eventId: string): Promise<void> {
        try {
            await cache.del(
                menuCacheKeys.eventMenu(vendorId, eventId),
                menuCacheKeys.eventConfig(vendorId, eventId)
            );
        } catch (error) {
            console.error('Error invalidating event menu caches:', error);
        }
    }

    async invalidateCache(vendorId: string, eventId?: string): Promise<void> {
        await this.invalidateMenuCaches(vendorId);
        if (eventId) await this.invalidateEventMenuCaches(vendorId, eventId);
    }
}
