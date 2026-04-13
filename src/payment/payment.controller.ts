import { FastifyPluginAsync } from 'fastify';
import { paymentService } from './payment.service.js';
import { StitchWebhookEvent } from './payment.types.js';
import { webhookSchema, paymentStatusSchema } from './payment.schema.js';
import { NotFoundError } from '../lib/errors.js';
import { supabase } from '../lib/supabase.js';
import { getWhatsappService } from '../whatsapp/whatsapp.service.js';
import { broadcastNewOrder, broadcastAdminOrderFeed, broadcastPaymentFailed } from '../websocket/index.js';
import { sendEmail } from '../lib/email.js';

/**
 * Extract orderId and status from a Stitch REST v2 webhook payload.
 */
function extractWebhookData(event: StitchWebhookEvent): { orderId: string | null; status: string | null } {
  const node = event.data?.client?.paymentInitiationRequests?.node;
  if (!node) return { orderId: null, status: null };

  const stateType = node.state?.__typename;
  const statusMap: Record<string, string> = {
    PaymentInitiationRequestCompleted: 'complete',
    PaymentInitiationRequestCancelled: 'cancelled',
    PaymentInitiationRequestExpired: 'expired',
  };

  return {
    orderId: node.externalReference || null,
    status: statusMap[stateType] || null,
  };
}

const paymentController: FastifyPluginAsync = async (fastify) => {
  // Capture raw request body for webhook signature verification
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const parsed = JSON.parse(body as string);
        (parsed as any).__rawBody = body;
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  /**
   * POST /payment/webhook
   * Receives Stitch REST v2 webhook events. Source of truth for payment status.
   * Signature: X-Stitch-Signature: t={timestamp},hmac_sha256={hex}
   */
  fastify.post('/webhook', { schema: webhookSchema, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const signatureHeader = request.headers['x-stitch-signature'] as string;
    const rawBody = (request.body as any)?.__rawBody || JSON.stringify(request.body);

    if (!signatureHeader) {
      fastify.log.warn('Missing X-Stitch-Signature header');
      return reply.status(401).send({ error: 'Missing signature' });
    }

    const isValid = await paymentService.verifyWebhookSignature(rawBody, signatureHeader);
    if (!isValid) {
      fastify.log.warn('Invalid Stitch webhook signature');
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const event = request.body as StitchWebhookEvent;
    const { orderId, status: paymentStatus } = extractWebhookData(event);

    if (!orderId || !paymentStatus) {
      fastify.log.warn({ body: request.body }, 'Could not extract orderId/status from webhook');
      return reply.status(200).send({ received: true });
    }

    fastify.log.info({ orderId, paymentStatus }, 'Stitch REST v2 webhook received');

    // Fetch the order
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      fastify.log.error({ orderId, error }, 'Order not found for webhook');
      return reply.status(200).send({ received: true });
    }

    if (paymentStatus === 'complete') {
      await completeOrder(order, orderId, fastify);
    } else if (['cancelled', 'expired'].includes(paymentStatus)) {
      await supabase
        .from('orders')
        .update({ payment_status: paymentStatus })
        .eq('id', orderId);

      // Restore inventory for failed payments
      const { error: restoreErr } = await supabase.rpc('restore_inventory', { p_order_id: orderId });
      if (restoreErr) fastify.log.error(restoreErr, 'Failed to restore inventory on payment failure');

      broadcastPaymentFailed({
        orderId: order.id,
        customerPhone: order.phone || null,
        vendorName: null,
        total: Number(order.total) || 0,
        paymentStatus,
        timestamp: new Date().toISOString(),
      });

      // Email customer about payment failure
      if (order.customer_id) {
        const { data: customer } = await supabase.from('customers').select('email, name').eq('id', order.customer_id).single();
        if (customer?.email) {
          void sendEmail({
            to: customer.email,
            subject: `Payment ${paymentStatus} — Order #${orderId.slice(0, 8)}`,
            html: `
              <h2>Payment Issue</h2>
              <p>Hi ${customer.name || 'there'},</p>
              <p>Your payment for order <strong>#${orderId.slice(0, 8)}</strong> has ${paymentStatus}.</p>
              <p>Please try placing your order again.</p>
            `,
          }).catch(err => fastify.log.error(err, 'Failed to send payment failure email'));
        }
      }
    }

    return reply.status(200).send({ received: true });
  });

  /**
   * GET /payment/status/:orderId
   * Frontend polls this to check if webhook has confirmed payment.
   * Also polls Stitch directly as a fallback.
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

    // If payment is still pending and we have a Stitch payment ID, poll Stitch
    if (order.payment_status === 'pending' && order.stitch_payment_id) {
      try {
        const stitchStatus = await paymentService.checkPaymentStatus(order.stitch_payment_id);

        if (stitchStatus === 'completed') {
          const { data: freshOrder } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

          if (freshOrder && freshOrder.status === 'PAYMENT_PENDING') {
            await completeOrder(freshOrder, orderId, fastify);
          }

          return { orderId: order.id, paymentStatus: 'complete', orderStatus: 'PENDING' };
        } else if (stitchStatus === 'cancelled') {
          await supabase.from('orders').update({ payment_status: 'cancelled' }).eq('id', orderId);
          return { orderId: order.id, paymentStatus: 'cancelled', orderStatus: order.status };
        } else if (stitchStatus === 'expired') {
          await supabase.from('orders').update({ payment_status: 'expired' }).eq('id', orderId);
          return { orderId: order.id, paymentStatus: 'expired', orderStatus: order.status };
        }
      } catch (err) {
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
 * Shared logic: mark order as paid, send notifications + push.
 */
async function completeOrder(order: any, orderId: string, fastify: any) {
  const { data: updated, error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'PENDING',
      payment_status: 'complete',
      paid_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', 'PAYMENT_PENDING')
    .select('id')
    .maybeSingle();

  if (!updateError && !updated) return;

  if (!updateError) {
    // WhatsApp notification
    try {
      const token = process.env.WA_ACCESS_TOKEN;
      if (token && token !== 'disabled' && process.env.NODE_ENV !== 'test' && order.phone) {
        const whatsapp = getWhatsappService();
        void whatsapp
          .sendOrderPlacedTemplate(order.phone, {
            orderId: String(order.id),
            total: String(order.total),
            prepTimeMinutes: String(order.estimated_prep_time || 15),
            qrImageUrl: order.qr_image,
          })
          .catch((err: any) => console.error('WhatsApp notification error:', err?.message || err));
      }
    } catch (notifyErr) {
      console.error('WhatsApp notification error (non-fatal):', (notifyErr as any)?.message || notifyErr);
    }

    // WebSocket: notify vendor KDS
    broadcastNewOrder({
      orderId: order.id,
      vendorId: order.vendor_id,
      eventId: order.event_id,
      phone: order.phone,
    });

    // WebSocket: notify admin dashboard
    broadcastAdminOrderFeed({
      orderId: order.id,
      customerPhone: order.phone || null,
      customerName: order.customer_name || null,
      vendorId: order.vendor_id,
      vendorName: null,
      eventId: order.event_id || null,
      eventName: null,
      total: Number(order.total) || 0,
      status: 'PENDING',
      paymentStatus: 'complete',
      items: Array.isArray(order.items) ? order.items.map((i: any) => ({ name: i.name || '', quantity: i.quantity || 1 })) : [],
      createdAt: order.created_at,
    });

    // Web Push: notify vendor of new order
    import('../push/push.service.js').then(({ pushService: push }) => {
      const orderRef = order.id.slice(-4).toUpperCase();
      push.sendToVendorUsers(order.vendor_id, {
        title: `New order #${orderRef}`,
        body: `R${Number(order.total || 0).toFixed(2)} — ${Array.isArray(order.items) ? order.items.length : 0} items`,
        tag: `new-order-${order.id}`,
        data: { url: '/lite/kds', type: 'new_order', orderId: order.id },
      }).catch(() => {});
    }).catch(() => {});
  }
}

export default paymentController;
