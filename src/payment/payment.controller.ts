import { FastifyPluginAsync } from 'fastify';
import { PaymentService } from './payment.service.js';
import { StitchWebhookEvent } from './payment.types.js';
import { webhookSchema, paymentStatusSchema } from './payment.schema.js';
import { NotFoundError } from '../lib/errors.js';
import { supabase } from '../lib/supabase.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { broadcastNewOrder, broadcastAdminOrderFeed, broadcastPaymentFailed } from '../websocket/index.js';

const paymentController: FastifyPluginAsync = async (fastify) => {
  const paymentService = new PaymentService();

  /**
   * POST /payment/webhook
   * Receives Stitch webhook events. Source of truth for payment status.
   */
  fastify.post('/webhook', { schema: webhookSchema }, async (request, reply) => {
    const signature = request.headers['x-stitch-signature'] as string;
    const rawBody = JSON.stringify(request.body);

    // Verify webhook signature
    const isValid = await paymentService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      fastify.log.warn('Invalid Stitch webhook signature');
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const event = request.body as StitchWebhookEvent;
    const orderId = event.data.paymentInitiationRequest.externalReference;
    const paymentStatus = event.data.paymentInitiationRequest.status;

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
      // Update order: PAYMENT_PENDING → PENDING, trigger notifications
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
          vendorName: null, // Will be enriched client-side or via snapshot
          eventId: order.event_id || null,
          eventName: null,
          total: Number(order.total_amount) || 0,
          status: 'PENDING',
          paymentStatus: 'complete',
          items: Array.isArray(order.items) ? order.items.map((i: any) => ({ name: i.name || i.menu_item_name || '', quantity: i.quantity || 1 })) : [],
          createdAt: order.created_at,
        });
      }
    } else if (paymentStatus === 'cancelled' || paymentStatus === 'expired' || paymentStatus === 'failed') {
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
   */
  fastify.get('/status/:orderId', { schema: paymentStatusSchema }, async (request) => {
    const { orderId } = request.params as { orderId: string };

    const { data: order, error } = await supabase
      .from('orders')
      .select('id, status, payment_status')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      throw new NotFoundError('Order not found');
    }

    return {
      orderId: order.id,
      paymentStatus: order.payment_status,
      orderStatus: order.status,
    };
  });
};

export default paymentController;
