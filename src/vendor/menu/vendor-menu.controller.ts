/**
 * Vendor Menu Controller
 * REST API endpoints for comprehensive menu management
 */

import { FastifyPluginAsync } from "fastify";
import { VendorMenuService } from "./vendor-menu.service";
import { requireFeature } from "../../lib/feature-flags.js";
import {
    // Default Menu Schemas
    getDefaultMenuSchema,
    getDefaultMenuItemSchema,
    createDefaultMenuItemSchema,
    updateDefaultMenuItemSchema,
    deleteDefaultMenuItemSchema,
    bulkCreateDefaultMenuItemsSchema,
    reorderMenuItemsSchema,

    // Event Menu Schemas
    getEventMenuSchema,
    getEventMenuItemSchema,
    upsertEventMenuItemSchema,
    updateEventMenuItemSchema,
    bulkUpdateEventMenuItemsSchema,
    bulkPriceAdjustmentSchema,
    resetEventMenuPricesSchema,
    cloneEventMenuSchema,

    // Event Config Schemas
    getEventMenuConfigSchema,
    updateEventMenuConfigSchema,
    publishEventMenuSchema,

    // Template Schemas
    getTemplatesSchema,
    getTemplateSchema,
    createTemplateSchema,
    updateTemplateSchema,
    deleteTemplateSchema,
    applyTemplateSchema,

    // Category Schemas
    getCategoriesSchema,
    createCategorySchema,
    updateCategorySchema,
    deleteCategorySchema,
    reorderCategoriesSchema,

    // Modifier Schemas
    getModifierGroupsSchema,
    createModifierGroupSchema,
    updateModifierGroupSchema,
    deleteModifierGroupSchema,
    addModifierSchema,
    updateModifierSchema,
    deleteModifierSchema,
    reorderModifiersSchema,

    // Tag Schemas
    getTagsSchema,
    createTagSchema,

    // Analytics Schemas
    getMenuAnalyticsSchema,

    // Scan Schemas
    scanMenuSchema,
} from "./vendor-menu.schema";

import { authenticateVendorOrAdmin, assertVendorOwnership } from "../../lib/auth.js";

const vendorMenuController: FastifyPluginAsync = async (fastify) => {
    const menuService = new VendorMenuService();

    // All non-GET requests require vendor or admin authentication + ownership check
    fastify.addHook('preHandler', async (request, reply) => {
        if (request.method !== 'GET') {
            await authenticateVendorOrAdmin(request, reply);
            const vendorId = (request.params as any)?.vendorId;
            if (vendorId) {
                assertVendorOwnership(request, vendorId);
            }
        }
    });

    // ==================== DEFAULT MENU ENDPOINTS ====================

    /**
     * GET /vendors/:vendorId/menu/default
     * Get complete default menu for a vendor
     */
    fastify.get<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/default",
        { schema: getDefaultMenuSchema },
        async (request, reply) => {
            try {
                const menu = await menuService.getDefaultMenu(request.params.vendorId);
                return menu;
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * GET /vendors/:vendorId/menu/default/items/:itemId
     * Get a single default menu item
     */
    fastify.get<{ Params: { vendorId: string; itemId: string } }>(
        "/:vendorId/menu/default/items/:itemId",
        { schema: getDefaultMenuItemSchema },
        async (request, reply) => {
            try {
                const item = await menuService.getDefaultMenuItem(
                    request.params.vendorId,
                    request.params.itemId
                );
                if (!item) {
                    return reply.status(404).send({ error: "Menu item not found" });
                }
                return { menuItem: item };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/default/items
     * Create a new default menu item
     */
    fastify.post<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/default/items",
        { schema: createDefaultMenuItemSchema },
        async (request, reply) => {
            try {
                const item = await menuService.createDefaultMenuItem(
                    request.params.vendorId,
                    request.body as any
                );
                return reply.status(201).send({ menuItem: item });
            } catch (err: any) {
                fastify.log.error(err);
                if (err.message.includes('Validation failed')) {
                    return reply.status(400).send({ error: err.message });
                }
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * PUT /vendors/:vendorId/menu/default/items/:itemId
     * Update a default menu item
     */
    fastify.put<{ Params: { vendorId: string; itemId: string } }>(
        "/:vendorId/menu/default/items/:itemId",
        { schema: updateDefaultMenuItemSchema },
        async (request, reply) => {
            try {
                const item = await menuService.updateDefaultMenuItem(
                    request.params.vendorId,
                    request.params.itemId,
                    request.body as any
                );
                return { menuItem: item };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * DELETE /vendors/:vendorId/menu/default/items/:itemId
     * Delete a default menu item
     */
    fastify.delete<{ Params: { vendorId: string; itemId: string } }>(
        "/:vendorId/menu/default/items/:itemId",
        { schema: deleteDefaultMenuItemSchema },
        async (request, reply) => {
            try {
                await menuService.deleteDefaultMenuItem(
                    request.params.vendorId,
                    request.params.itemId
                );
                return reply.status(204).send();
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/default/items/bulk
     * Bulk create default menu items
     */
    fastify.post<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/default/items/bulk",
        { schema: bulkCreateDefaultMenuItemsSchema },
        async (request, reply) => {
            try {
                const { items } = request.body as { items: any[] };
                const createdItems = await menuService.bulkCreateDefaultMenuItems(
                    request.params.vendorId,
                    items
                );
                return reply.status(201).send({ menuItems: createdItems, count: createdItems.length });
            } catch (err: any) {
                fastify.log.error(err);
                if (err.message.includes('Validation failed')) {
                    return reply.status(400).send({ error: err.message });
                }
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * PUT /vendors/:vendorId/menu/default/items/reorder
     * Bulk reorder menu items (update displayOrder and optionally categoryId)
     */
    fastify.put<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/default/items/reorder",
        { schema: reorderMenuItemsSchema },
        async (request, reply) => {
            try {
                const { orders } = request.body as { orders: { id: string; displayOrder: number; categoryId?: string }[] };
                await menuService.reorderMenuItems(request.params.vendorId, orders);
                return { success: true };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    // ==================== EVENT MENU ENDPOINTS ====================

    /**
     * GET /vendors/:vendorId/menu/events/:eventId
     * Get complete event-specific menu
     */
    fastify.get<{ Params: { vendorId: string; eventId: string } }>(
        "/:vendorId/menu/events/:eventId",
        { schema: getEventMenuSchema },
        async (request, reply) => {
            try {
                const menu = await menuService.getEventMenu(
                    request.params.vendorId,
                    request.params.eventId
                );
                return menu;
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * GET /vendors/:vendorId/menu/events/:eventId/items/:eventMenuItemId
     * Get a single event menu item with full details for frontend configuration
     */
    fastify.get<{ Params: { vendorId: string; eventId: string; eventMenuItemId: string } }>(
        "/:vendorId/menu/events/:eventId/items/:eventMenuItemId",
        { schema: getEventMenuItemSchema },
        async (request, reply) => {
            try {
                const eventMenuItem = await menuService.getEventMenuItem(
                    request.params.vendorId,
                    request.params.eventId,
                    request.params.eventMenuItemId
                );
                return { eventMenuItem };
            } catch (err: any) {
                fastify.log.error(err);
                if (err.message?.includes('not found')) {
                    return reply.status(404).send({ error: err.message });
                }
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/events/:eventId/items
     * Create or update an event menu item override
     */
    fastify.post<{ Params: { vendorId: string; eventId: string } }>(
        "/:vendorId/menu/events/:eventId/items",
        { schema: upsertEventMenuItemSchema },
        async (request, reply) => {
            try {
                const item = await menuService.upsertEventMenuItem(
                    request.params.vendorId,
                    request.params.eventId,
                    request.body as any
                );
                return reply.status(201).send({ eventMenuItem: item });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * PUT /vendors/:vendorId/menu/events/:eventId/items/:eventItemId
     * Update an event menu item
     */
    fastify.put<{ Params: { vendorId: string; eventId: string; eventItemId: string } }>(
        "/:vendorId/menu/events/:eventId/items/:eventItemId",
        { schema: updateEventMenuItemSchema },
        async (request, reply) => {
            try {
                const item = await menuService.updateEventMenuItem(
                    request.params.vendorId,
                    request.params.eventId,
                    request.params.eventItemId,
                    request.body as any
                );
                return { eventMenuItem: item };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/events/:eventId/items/bulk
     * Bulk update event menu items
     */
    fastify.post<{ Params: { vendorId: string; eventId: string } }>(
        "/:vendorId/menu/events/:eventId/items/bulk",
        { schema: bulkUpdateEventMenuItemsSchema },
        async (request, reply) => {
            try {
                const { updates } = request.body as { updates: any[] };
                const items = await menuService.bulkUpdateEventMenuItems(
                    request.params.vendorId,
                    { eventId: request.params.eventId, updates }
                );
                return { eventMenuItems: items, count: items.length };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/events/:eventId/price-adjustment
     * Apply bulk price adjustment
     */
    fastify.post<{ Params: { vendorId: string; eventId: string } }>(
        "/:vendorId/menu/events/:eventId/price-adjustment",
        { schema: bulkPriceAdjustmentSchema },
        async (request, reply) => {
            try {
                const body = request.body as any;
                const result = await menuService.bulkPriceAdjustment(
                    request.params.vendorId,
                    { eventId: request.params.eventId, ...body }
                );
                return result;
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/events/:eventId/reset-prices
     * Reset all event menu item prices to defaults
     * Removes all price overrides so items use their default menu prices
     */
    fastify.post<{ Params: { vendorId: string; eventId: string } }>(
        "/:vendorId/menu/events/:eventId/reset-prices",
        { schema: resetEventMenuPricesSchema },
        async (request, reply) => {
            const result = await menuService.resetEventMenuPrices(
                request.params.vendorId,
                request.params.eventId
            );
            return result;
        }
    );

    /**
     * POST /vendors/:vendorId/menu/events/:eventId/clone
     * Clone menu from another event
     */
    fastify.post<{ Params: { vendorId: string; eventId: string } }>(
        "/:vendorId/menu/events/:eventId/clone",
        { schema: cloneEventMenuSchema },
        async (request, reply) => {
            try {
                const { sourceEventId, includeOverrides } = request.body as any;
                const result = await menuService.cloneEventMenu(
                    request.params.vendorId,
                    {
                        sourceEventId,
                        targetEventId: request.params.eventId,
                        includeOverrides,
                    }
                );
                return result;
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    // ==================== EVENT CONFIG ENDPOINTS ====================

    /**
     * GET /vendors/:vendorId/menu/events/:eventId/config
     * Get event menu configuration
     */
    fastify.get<{ Params: { vendorId: string; eventId: string } }>(
        "/:vendorId/menu/events/:eventId/config",
        { schema: getEventMenuConfigSchema },
        async (request, reply) => {
            try {
                const config = await menuService.getOrCreateEventMenuConfig(
                    request.params.vendorId,
                    request.params.eventId
                );
                return { configuration: config };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * PUT /vendors/:vendorId/menu/events/:eventId/config
     * Update event menu configuration
     */
    fastify.put<{ Params: { vendorId: string; eventId: string } }>(
        "/:vendorId/menu/events/:eventId/config",
        { schema: updateEventMenuConfigSchema },
        async (request, reply) => {
            try {
                const config = await menuService.updateEventMenuConfig(
                    request.params.vendorId,
                    request.params.eventId,
                    request.body as any
                );
                return { configuration: config };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/events/:eventId/publish
     * Publish event menu
     */
    fastify.post<{ Params: { vendorId: string; eventId: string } }>(
        "/:vendorId/menu/events/:eventId/publish",
        { schema: publishEventMenuSchema },
        async (request, reply) => {
            try {
                const config = await menuService.publishEventMenu(
                    request.params.vendorId,
                    request.params.eventId
                );
                return { configuration: config };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    // ==================== TEMPLATE ENDPOINTS ====================

    /**
     * GET /vendors/:vendorId/menu/templates
     * Get all templates for a vendor
     */
    fastify.get<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/templates",
        { schema: getTemplatesSchema, preHandler: [requireFeature('menu_templates')] },
        async (request, reply) => {
            try {
                const templates = await menuService.getVendorTemplates(request.params.vendorId);
                return { templates };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * GET /vendors/:vendorId/menu/templates/:templateId
     * Get a single template with preview
     */
    fastify.get<{ Params: { vendorId: string; templateId: string } }>(
        "/:vendorId/menu/templates/:templateId",
        { schema: getTemplateSchema, preHandler: [requireFeature('menu_templates')] },
        async (request, reply) => {
            try {
                const response = await menuService.getTemplate(
                    request.params.vendorId,
                    request.params.templateId
                );
                return response;
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/templates
     * Create a new template
     */
    fastify.post<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/templates",
        { schema: createTemplateSchema, preHandler: [requireFeature('menu_templates')] },
        async (request, reply) => {
            try {
                const template = await menuService.createTemplate(
                    request.params.vendorId,
                    request.body as any
                );
                return reply.status(201).send({ template });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * PUT /vendors/:vendorId/menu/templates/:templateId
     * Update a template
     */
    fastify.put<{ Params: { vendorId: string; templateId: string } }>(
        "/:vendorId/menu/templates/:templateId",
        { schema: updateTemplateSchema, preHandler: [requireFeature('menu_templates')] },
        async (request, reply) => {
            try {
                const template = await menuService.updateTemplate(
                    request.params.vendorId,
                    request.params.templateId,
                    request.body as any
                );
                return { template };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * DELETE /vendors/:vendorId/menu/templates/:templateId
     * Delete a template
     */
    fastify.delete<{ Params: { vendorId: string; templateId: string } }>(
        "/:vendorId/menu/templates/:templateId",
        { schema: deleteTemplateSchema, preHandler: [requireFeature('menu_templates')] },
        async (request, reply) => {
            try {
                await menuService.deleteTemplate(
                    request.params.vendorId,
                    request.params.templateId
                );
                return reply.status(204).send();
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/templates/:templateId/apply
     * Apply template to an event
     */
    fastify.post<{ Params: { vendorId: string; templateId: string } }>(
        "/:vendorId/menu/templates/:templateId/apply",
        { schema: applyTemplateSchema, preHandler: [requireFeature('menu_templates')] },
        async (request, reply) => {
            try {
                const { eventId, overrideExisting } = request.body as any;
                const result = await menuService.applyTemplateToEvent(
                    request.params.vendorId,
                    {
                        templateId: request.params.templateId,
                        eventId,
                        overrideExisting,
                    }
                );
                return result;
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    // ==================== CATEGORY ENDPOINTS ====================

    /**
     * GET /vendors/:vendorId/menu/categories
     * Get all categories
     */
    fastify.get<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/categories",
        { schema: getCategoriesSchema },
        async (request, reply) => {
            try {
                const categories = await menuService.getVendorCategories(request.params.vendorId);
                return { categories };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/categories
     * Create a new category
     */
    fastify.post<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/categories",
        { schema: createCategorySchema },
        async (request, reply) => {
            try {
                const category = await menuService.createCategory(
                    request.params.vendorId,
                    request.body as any
                );
                return reply.status(201).send({ category });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * PUT /vendors/:vendorId/menu/categories/:categoryId
     * Update a category
     */
    fastify.put<{ Params: { vendorId: string; categoryId: string } }>(
        "/:vendorId/menu/categories/:categoryId",
        { schema: updateCategorySchema },
        async (request, reply) => {
            try {
                const category = await menuService.updateCategory(
                    request.params.vendorId,
                    request.params.categoryId,
                    request.body as any
                );
                return { category };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * DELETE /vendors/:vendorId/menu/categories/:categoryId
     * Delete a category
     */
    fastify.delete<{ Params: { vendorId: string; categoryId: string } }>(
        "/:vendorId/menu/categories/:categoryId",
        { schema: deleteCategorySchema },
        async (request, reply) => {
            try {
                await menuService.deleteCategory(
                    request.params.vendorId,
                    request.params.categoryId
                );
                return reply.status(204).send();
            } catch (err: any) {
                fastify.log.error(err);
                if (err.message.includes('Cannot delete')) {
                    return reply.status(400).send({ error: err.message });
                }
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * PUT /vendors/:vendorId/menu/categories/reorder
     * Reorder categories
     */
    fastify.put<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/categories/reorder",
        { schema: reorderCategoriesSchema },
        async (request, reply) => {
            try {
                const { orders } = request.body as { orders: { id: string; displayOrder: number }[] };
                await menuService.reorderCategories(request.params.vendorId, orders);
                return { success: true };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    // ==================== MODIFIER ENDPOINTS ====================

    /**
     * GET /vendors/:vendorId/menu/modifier-groups
     * Get all modifier groups
     */
    fastify.get<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/modifier-groups",
        { schema: getModifierGroupsSchema },
        async (request, reply) => {
            try {
                const modifierGroups = await menuService.getVendorModifierGroups(request.params.vendorId);
                return { modifierGroups };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/modifier-groups
     * Create a modifier group
     */
    fastify.post<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/modifier-groups",
        { schema: createModifierGroupSchema },
        async (request, reply) => {
            try {
                const group = await menuService.createModifierGroup(
                    request.params.vendorId,
                    request.body as any
                );
                return reply.status(201).send({ modifierGroup: group });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/modifier-groups/:groupId/modifiers
     * Add a modifier to a group
     */
    fastify.post<{ Params: { vendorId: string; groupId: string } }>(
        "/:vendorId/menu/modifier-groups/:groupId/modifiers",
        { schema: addModifierSchema },
        async (request, reply) => {
            try {
                const modifier = await menuService.addModifier(
                    request.params.vendorId,
                    request.params.groupId,
                    request.body as any
                );
                return reply.status(201).send({ modifier });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * PUT /vendors/:vendorId/menu/modifier-groups/:groupId
     * Update a modifier group
     */
    fastify.put<{ Params: { vendorId: string; groupId: string } }>(
        "/:vendorId/menu/modifier-groups/:groupId",
        { schema: updateModifierGroupSchema },
        async (request, reply) => {
            try {
                const group = await menuService.updateModifierGroup(
                    request.params.vendorId,
                    request.params.groupId,
                    request.body as any
                );
                return { modifierGroup: group };
            } catch (err: any) {
                fastify.log.error(err);
                if (err.message.includes('not found')) {
                    return reply.status(404).send({ error: err.message });
                }
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * DELETE /vendors/:vendorId/menu/modifier-groups/:groupId
     * Delete a modifier group
     */
    fastify.delete<{ Params: { vendorId: string; groupId: string } }>(
        "/:vendorId/menu/modifier-groups/:groupId",
        { schema: deleteModifierGroupSchema },
        async (request, reply) => {
            try {
                await menuService.deleteModifierGroup(
                    request.params.vendorId,
                    request.params.groupId
                );
                return reply.status(204).send();
            } catch (err: any) {
                fastify.log.error(err);
                if (err.message.includes('Cannot delete')) {
                    return reply.status(400).send({ error: err.message });
                }
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * PUT /vendors/:vendorId/menu/modifier-groups/:groupId/modifiers/:modifierId
     * Update a modifier
     */
    fastify.put<{ Params: { vendorId: string; groupId: string; modifierId: string } }>(
        "/:vendorId/menu/modifier-groups/:groupId/modifiers/:modifierId",
        { schema: updateModifierSchema },
        async (request, reply) => {
            try {
                const modifier = await menuService.updateModifier(
                    request.params.vendorId,
                    request.params.groupId,
                    request.params.modifierId,
                    request.body as any
                );
                return { modifier };
            } catch (err: any) {
                fastify.log.error(err);
                if (err.message.includes('not found')) {
                    return reply.status(404).send({ error: err.message });
                }
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * DELETE /vendors/:vendorId/menu/modifier-groups/:groupId/modifiers/:modifierId
     * Delete a modifier
     */
    fastify.delete<{ Params: { vendorId: string; groupId: string; modifierId: string } }>(
        "/:vendorId/menu/modifier-groups/:groupId/modifiers/:modifierId",
        { schema: deleteModifierSchema },
        async (request, reply) => {
            try {
                await menuService.deleteModifier(
                    request.params.vendorId,
                    request.params.groupId,
                    request.params.modifierId
                );
                return reply.status(204).send();
            } catch (err: any) {
                fastify.log.error(err);
                if (err.message.includes('not found')) {
                    return reply.status(404).send({ error: err.message });
                }
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * PUT /vendors/:vendorId/menu/modifier-groups/:groupId/reorder
     * Reorder modifiers within a group
     */
    fastify.put<{ Params: { vendorId: string; groupId: string } }>(
        "/:vendorId/menu/modifier-groups/:groupId/reorder",
        { schema: reorderModifiersSchema },
        async (request, reply) => {
            try {
                const { orders } = request.body as { orders: { id: string; displayOrder: number }[] };
                await menuService.reorderModifiers(request.params.vendorId, request.params.groupId, orders);
                return { success: true };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    // ==================== TAG ENDPOINTS ====================

    /**
     * GET /vendors/:vendorId/menu/tags
     * Get all tags
     */
    fastify.get<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/tags",
        { schema: getTagsSchema },
        async (request, reply) => {
            try {
                const tags = await menuService.getAllTags();
                return { tags };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * POST /vendors/:vendorId/menu/tags
     * Create a tag
     */
    fastify.post<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/tags",
        { schema: createTagSchema },
        async (request, reply) => {
            try {
                const tag = await menuService.createTag(request.body as any);
                return reply.status(201).send({ tag });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    // ==================== ANALYTICS ENDPOINTS ====================

    /**
     * GET /vendors/:vendorId/menu/analytics
     * Get menu analytics
     */
    fastify.get<{
        Params: { vendorId: string };
        Querystring: { eventId?: string; startDate?: string; endDate?: string };
    }>(
        "/:vendorId/menu/analytics",
        { schema: getMenuAnalyticsSchema },
        async (request, reply) => {
            try {
                const { eventId, startDate, endDate } = request.query;
                const analytics = await menuService.getMenuAnalytics(
                    request.params.vendorId,
                    eventId,
                    startDate,
                    endDate
                );
                return analytics;
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    // ==================== AI MENU SCAN ====================

    // In-memory store for scan jobs (pending AI results)
    const scanJobs = new Map<string, { status: 'processing' | 'done' | 'error'; result?: any; error?: string }>();

    /**
     * POST /vendors/:vendorId/menu/scan
     * Upload a menu image — kicks off AI extraction in the background, returns a scanId immediately.
     */
    fastify.post<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/scan",
        {
            bodyLimit: 15_000_000,
            config: { rateLimit: { max: 10, timeWindow: '24 hours' } },
        },
        async (request, reply) => {
            try {
                const { image, mimeType } = request.body as { image: string; mimeType: string };

                if (image.length > 14_000_000) {
                    return reply.status(400).send({ error: 'Image too large. Maximum size is 10MB.' });
                }

                // Generate a scan ID and return immediately
                const scanId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                scanJobs.set(scanId, { status: 'processing' });

                // Process in background — don't await
                menuService.scanMenuImage(request.params.vendorId, image, mimeType)
                    .then((result) => {
                        if (result.error === 'RATE_LIMITED') {
                            scanJobs.set(scanId, { status: 'error', error: result.message });
                        } else {
                            scanJobs.set(scanId, { status: 'done', result });
                        }
                        // Clean up after 5 minutes
                        setTimeout(() => scanJobs.delete(scanId), 5 * 60 * 1000);
                    })
                    .catch((err) => {
                        fastify.log.error(err);
                        scanJobs.set(scanId, { status: 'error', error: 'Failed to scan menu. Please try again.' });
                        setTimeout(() => scanJobs.delete(scanId), 5 * 60 * 1000);
                    });

                return reply.status(202).send({ scanId });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Failed to start scan." });
            }
        }
    );

    /**
     * GET /vendors/:vendorId/menu/scan/:scanId
     * Poll for scan results. Returns status: processing | done | error.
     */
    fastify.get<{ Params: { vendorId: string; scanId: string } }>(
        "/:vendorId/menu/scan/:scanId",
        async (request, reply) => {
            const job = scanJobs.get(request.params.scanId);
            if (!job) {
                return reply.status(404).send({ error: 'Scan not found or expired' });
            }

            if (job.status === 'processing') {
                return { status: 'processing' };
            }

            if (job.status === 'error') {
                return reply.status(422).send({ status: 'error', error: job.error });
            }

            // Done — return result and clean up
            scanJobs.delete(request.params.scanId);
            return { status: 'done', ...job.result };
        }
    );

    // ==================== CACHE INVALIDATION ====================

    /**
     * POST /vendors/:vendorId/menu/invalidate-cache
     * Manual cache invalidation
     */
    fastify.post<{ Params: { vendorId: string } }>(
        "/:vendorId/menu/invalidate-cache",
        async (request, reply) => {
            try {
                const { eventId } = request.body as { eventId?: string };
                await menuService.invalidateCache(request.params.vendorId, eventId);
                return { success: true };
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );
};

export default vendorMenuController;
