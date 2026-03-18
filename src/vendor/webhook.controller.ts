import { FastifyPluginAsync } from 'fastify';
import { VendorService } from '../vendor/vendor.service';

/**
 * Webhook Controller for Cache Invalidation
 *
 * Set up Supabase webhooks to call these endpoints when data changes
 * This ensures cache stays in sync with database updates
 */
const webhookController: FastifyPluginAsync = async (fastify) => {
    const vendorService = new VendorService();

    /**
     * Webhook: Invalidate vendor cache
     * Trigger: When vendors table changes (INSERT, UPDATE, DELETE)
     *
     * Supabase Webhook Config:
     * - Table: vendors
     * - Events: INSERT, UPDATE, DELETE
     * - URL: https://your-api.com/webhooks/vendor-updated
     */
    fastify.post('/vendor-updated', async (request, reply) => {
        try {
            const { type, record, old_record } = request.body as {
                type: 'INSERT' | 'UPDATE' | 'DELETE';
                record?: any;
                old_record?: any;
            };

            // Get vendor ID (from record for INSERT/UPDATE, from old_record for DELETE)
            const vendorId = record?.id || old_record?.id;

            if (!vendorId) {
                return reply.status(400).send({
                    success: false,
                    error: 'Missing vendor ID in webhook payload',
                });
            }

            // Invalidate all vendor-related caches
            await vendorService.invalidateCache(vendorId);

            fastify.log.info({
                type,
                vendorId,
                message: 'Vendor cache invalidated via webhook',
            });

            return {
                success: true,
                message: 'Cache invalidated successfully',
                vendorId,
            };
        } catch (error: any) {
            fastify.log.error('Webhook error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to process webhook',
            });
        }
    });

    /**
     * Webhook: Invalidate menu cache
     * Trigger: When default_menu_items table changes
     *
     * Supabase Webhook Config:
     * - Table: default_menu_items
     * - Events: INSERT, UPDATE, DELETE
     * - URL: https://your-api.com/webhooks/menu-updated
     */
    fastify.post('/menu-updated', async (request, reply) => {
        try {
            const { type, record, old_record } = request.body as {
                type: 'INSERT' | 'UPDATE' | 'DELETE';
                record?: any;
                old_record?: any;
            };

            // Get vendor ID
            const vendorId = record?.vendor_id || old_record?.vendor_id;

            if (!vendorId) {
                return reply.status(400).send({
                    success: false,
                    error: 'Missing vendor_id in webhook payload',
                });
            }

            // Invalidate vendor's menu cache
            await vendorService.invalidateCache(vendorId);

            fastify.log.info({
                type,
                vendorId,
                menuItemId: record?.id || old_record?.id,
                message: 'Menu cache invalidated via webhook',
            });

            return {
                success: true,
                message: 'Menu cache invalidated successfully',
                vendorId,
            };
        } catch (error: any) {
            fastify.log.error('Webhook error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to process webhook',
            });
        }
    });

    /**
     * Manual cache invalidation endpoint
     * Use for testing or manual cache clearing
     *
     * POST /webhooks/invalidate-cache
     * Body: { vendorId?: string }
     */
    fastify.post('/invalidate-cache', async (request, reply) => {
        try {
            const { vendorId } = request.body as { vendorId?: string };

            await vendorService.invalidateCache(vendorId);

            fastify.log.info({
                vendorId: vendorId || 'all',
                message: 'Manual cache invalidation',
            });

            return {
                success: true,
                message: vendorId
                    ? `Cache invalidated for vendor: ${vendorId}`
                    : 'All vendor caches invalidated',
            };
        } catch (error: any) {
            fastify.log.error('Manual invalidation error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to invalidate cache',
            });
        }
    });

    /**
     * Health check for webhooks
     */
    fastify.get('/health', async (request, reply) => {
        return {
            status: 'ok',
            service: 'webhooks',
            timestamp: new Date().toISOString(),
        };
    });
};

export default webhookController;
