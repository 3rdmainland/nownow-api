/**
 * Vendor Menu Controller
 * REST API endpoints for comprehensive menu management
 */

import { FastifyPluginAsync } from "fastify";
import { VendorMenuService } from "./vendor-menu.service";
import {
    // Default Menu Schemas
    getDefaultMenuSchema,
    getDefaultMenuItemSchema,
    createDefaultMenuItemSchema,
    updateDefaultMenuItemSchema,
    deleteDefaultMenuItemSchema,
    bulkCreateDefaultMenuItemsSchema,

    // Event Menu Schemas
    getEventMenuSchema,
    upsertEventMenuItemSchema,
    updateEventMenuItemSchema,
    bulkUpdateEventMenuItemsSchema,
    bulkPriceAdjustmentSchema,
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
    addModifierSchema,

    // Tag Schemas
    getTagsSchema,
    createTagSchema,

    // Analytics Schemas
    getMenuAnalyticsSchema,
} from "./vendor-menu.schema";

const vendorMenuController: FastifyPluginAsync = async (fastify) => {
    const menuService = new VendorMenuService();

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
        { schema: getTemplatesSchema },
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
        { schema: getTemplateSchema },
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
        { schema: createTemplateSchema },
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
        { schema: updateTemplateSchema },
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
        { schema: deleteTemplateSchema },
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
        { schema: applyTemplateSchema },
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
