import { FastifyPluginAsync } from 'fastify';
import { PaymentService } from './payment.service.js';
import { StitchWebhookEvent } from './payment.types.js';
import { webhookSchema, paymentStatusSchema } from './payment.schema.js';
import { NotFoundError } from '../lib/errors.js';
import { supabase } from '../lib/supabase.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { broadcastNewOrder, broadcastAdminOrderFeed, broadcastPaymentFailed } from '../websocket/index.js';

/**
 * Extract orderId and status from a Stitch webhook payload.
 * Handles both Express format (data.payment) and Core format (data.paymentInitiationRequest).
 */
function extractWebhookData(event: StitchWebhookEvent): { orderId: string | null; status: string | null } {
  // Try Express format first
  if (event.data?.payment) {
    const p = event.data.payment;
    const rawStatus = (p.status || '').toUpperCase();
    // Map Express statuses to our internal format
    const statusMap: Record<string, string> = {
      PAID: 'complete',
      SETTLED: 'complete',
      CANCELLED: 'cancelled',
      EXPIRED: 'expired',
    };
    return {
      orderId: p.merchantReference || null,
      status: statusMap[rawStatus] || rawStatus.toLowerCase(),
    };
  }

  // Fallback to Core format
  if (event.data?.paymentInitiationRequest) {
    const p = event.data.paymentInitiationRequest;
    return {
      orderId: p.externalReference || null,
      status: p.status || null,
    };
  }

  return { orderId: null, status: null };
}

const paymentController: FastifyPluginAsync = async (fastify) => {
  const paymentService = new PaymentService();

  // Register redirect URL with Stitch on startup (fire-and-forget)
  paymentService.registerRedirectUrl().catch(err => {
    fastify.log.warn({ err }, 'Failed to register Stitch redirect URL on startup');
  });

  /**
   * POST /payment/webhook
   * Receives Stitch webhook events. Source of truth for payment status.
   */
  fastify.post('/webhook', { schema: webhookSchema }, async (request, reply) => {
    const svixId = request.headers['svix-id'] as string;
    const svixTimestamp = request.headers['svix-timestamp'] as string;
    const svixSignature = request.headers['svix-signature'] as string;
    const rawBody = JSON.stringify(request.body);

    if (!svixId || !svixTimestamp || !svixSignature) {
      fastify.log.warn('Missing Svix webhook headers');
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    // Verify Svix webhook signature
    const isValid = await paymentService.verifyWebhookSignature(rawBody, svixId, svixTimestamp, svixSignature);
    if (!isValid) {
      fastify.log.warn('Invalid Stitch webhook signature');
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const event = request.body as StitchWebhookEvent;
    const { orderId, status: paymentStatus } = extractWebhookData(event);

    if (!orderId || !paymentStatus) {
      fastify.log.warn({ body: request.body }, 'Could not extract orderId/status from webhook');
      return { received: true };
    }

    fastify.log.info({ orderId, paymentStatus, eventType: event.type }, 'Stitch webhook received');

    // Fetch the order
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      fastify.log.error({ orderId, error }, 'Order not found for webhook');
      return { received: true };
    }

    if (paymentStatus === 'complete') {
      await completeOrder(order, orderId, fastify);
    } else if (['cancelled', 'expired', 'failed'].includes(paymentStatus)) {
      await supabase
        .from('orders')
        .update({ payment_status: paymentStatus })
        .eq('id', orderId);

      // Notify admins of payment failure
      broadcastPaymentFailed({
        orderId: order.id,
        customerPhone: order.phone || null,
        vendorName: null,
        total: Number(order.total_amount) || 0,
        paymentStatus,
        timestamp: new Date().toISOString(),
      });
    }

    return { received: true };
  });

  /**
   * GET /payment/status/:orderId
   * Frontend polls this to check if webhook has confirmed payment.
   * Also polls Stitch directly as a fallback if our DB still shows pending.
   */
  fastify.get('/status/:orderId', { schema: paymentStatusSchema }, async (request) => {
    const { orderId } = request.params as { orderId: string };

    const { data: order, error } = await supabase
      .from('orders')
      .select('id, status, payment_status, stitch_payment_id')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      throw new NotFoundError('Order not found');
    }

    // If payment is still pending and we have a Stitch payment ID, poll Stitch directly
    if (order.payment_status === 'pending' && order.stitch_payment_id) {
      try {
        const stitchStatus = await paymentService.checkPaymentStatus(order.stitch_payment_id);
        const upper = stitchStatus.toUpperCase();

        if (upper === 'PAID' || upper === 'SETTLED') {
          // Stitch says paid but our DB is behind — update now
          const { data: freshOrder } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

          if (freshOrder && freshOrder.status === 'PAYMENT_PENDING') {
            await completeOrder(freshOrder, orderId, fastify);
          }

          return {
            orderId: order.id,
            paymentStatus: 'complete',
            orderStatus: 'PENDING',
          };
        } else if (upper === 'CANCELLED') {
          await supabase.from('orders').update({ payment_status: 'cancelled' }).eq('id', orderId);
          return { orderId: order.id, paymentStatus: 'cancelled', orderStatus: order.status };
        } else if (upper === 'EXPIRED') {
          await supabase.from('orders').update({ payment_status: 'expired' }).eq('id', orderId);
          return { orderId: order.id, paymentStatus: 'expired', orderStatus: order.status };
        }
      } catch (err) {
        // If Stitch poll fails, fall through and return DB status
        fastify.log.warn({ err, orderId }, 'Failed to poll Stitch for payment status');
      }
    }

    return {
      orderId: order.id,
      paymentStatus: order.payment_status,
      orderStatus: order.status,
    };
  });
};

/**
 * Shared logic: mark order as paid, send notifications.
 */
async function completeOrder(order: any, orderId: string, fastify: any) {
  const { error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'PENDING',
      payment_status: 'complete',
      paid_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', 'PAYMENT_PENDING');

  if (!updateError) {
    // Fire-and-forget WhatsApp notification
    try {
      const token = process.env.WA_ACCESS_TOKEN;
      if (token && token !== 'disabled' && process.env.NODE_ENV !== 'test' && order.phone) {
        const whatsapp = new WhatsappService();

        void whatsapp
          .sendOrderPlacedTemplate(order.phone, {
            orderId: String(order.id),
            total: String(order.total),
            prepTimeMinutes: String(order.estimated_prep_time || 15),
            qrImageUrl: order.qr_image,
          })
          .catch((err: any) => {
            console.error('Failed to send WhatsApp notification:', err?.message || err);
          });
      }
    } catch (notifyErr) {
      console.error('WhatsApp notification error (non-fatal):', (notifyErr as any)?.message || notifyErr);
    }

    // Notify the vendor's live panel in real time
    broadcastNewOrder({
      orderId: order.id,
      vendorId: order.vendor_id,
      eventId: order.event_id,
    });

    // Notify admin dashboard
    broadcastAdminOrderFeed({
      orderId: order.id,
      customerPhone: order.phone || null,
      customerName: order.customer_name || null,
      vendorId: order.vendor_id,
      vendorName: null,
      eventId: order.event_id || null,
      eventName: null,
      total: Number(order.total_amount) || 0,
      status: 'PENDING',
      paymentStatus: 'complete',
      items: Array.isArray(order.items) ? order.items.map((i: any) => ({ name: i.name || i.menu_item_name || '', quantity: i.quantity || 1 })) : [],
      createdAt: order.created_at,
    });
  }
}

export default paymentController;
