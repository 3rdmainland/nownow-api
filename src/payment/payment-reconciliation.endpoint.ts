import type { FastifyPluginAsync } from 'fastify';
import { Receiver } from '@upstash/qstash';
import { supabase } from '../lib/supabase.js';
import { paymentService } from './payment.service.js';

const receiver = (process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)
  ? new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    })
  : null;

/**
 * Internal endpoint called by QStash every 5 minutes.
 * Reconciles orphaned payments and cleans up stale orders.
 */
const reconciliationEndpoint: FastifyPluginAsync = async (fastify) => {
  fastify.post('/reconcile', async (request, reply) => {
    // Verify QStash signature in production
    if (receiver) {
      try {
        const signature = request.headers['upstash-signature'] as string;
        if (!signature) return reply.status(401).send({ error: 'Missing QStash signature' });
        const rawBody = JSON.stringify(request.body);
        const isValid = await receiver.verify({ signature, body: rawBody });
        if (!isValid) return reply.status(401).send({ error: 'Invalid QStash signature' });
      } catch {
        return reply.status(401).send({ error: 'Signature verification failed' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      return reply.status(500).send({ error: 'QStash signing keys not configured' });
    }

    let reconciled = 0;
    let cancelled = 0;

    // 1. Find orphaned PAYMENT_PENDING orders (>15 min, has Stitch ID)
    const { data: orphaned } = await supabase
      .from('orders')
      .select('id, stitch_payment_id, created_at')
      .eq('status', 'PAYMENT_PENDING')
      .not('stitch_payment_id', 'is', null)
      .lt('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString());

    for (const order of orphaned || []) {
      try {
        const status = await paymentService.checkPaymentStatus(order.stitch_payment_id);

        if (status === 'completed') {
          await supabase
            .from('orders')
            .update({ status: 'PENDING', payment_status: 'complete', paid_at: new Date().toISOString() })
            .eq('id', order.id)
            .eq('status', 'PAYMENT_PENDING');
          reconciled++;
          fastify.log.info({ orderId: order.id }, 'Reconciliation: completed orphaned order');
        } else if (status === 'expired' || status === 'cancelled') {
          await supabase
            .from('orders')
            .update({ status: 'CANCELLED', payment_status: status })
            .eq('id', order.id);
          void supabase.rpc('restore_inventory', { p_order_id: order.id });
          cancelled++;
        } else if (status === 'pending') {
          // Still pending after 30 min — cancel the payment
          const age = Date.now() - new Date(order.created_at).getTime();
          if (age > 30 * 60 * 1000) {
            await paymentService.cancelPaymentRequest(order.stitch_payment_id, 'timeout').catch(() => {});
            await supabase
              .from('orders')
              .update({ status: 'CANCELLED', payment_status: 'expired' })
              .eq('id', order.id);
            void supabase.rpc('restore_inventory', { p_order_id: order.id });
            cancelled++;
          }
        }
      } catch (err) {
        fastify.log.error({ orderId: order.id, err }, 'Reconciliation failed for order');
      }
    }

    // 2. Clean up stale orders with no payment ID (>10 min)
    const { data: stale } = await supabase
      .from('orders')
      .select('id')
      .eq('status', 'PAYMENT_PENDING')
      .is('stitch_payment_id', null)
      .lt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());

    for (const order of stale || []) {
      await supabase
        .from('orders')
        .update({ status: 'CANCELLED', payment_status: 'expired' })
        .eq('id', order.id);
      void supabase.rpc('restore_inventory', { p_order_id: order.id });
      cancelled++;
    }

    fastify.log.info({ reconciled, cancelled }, 'Payment reconciliation complete');
    return { reconciled, cancelled };
  });
};

export default reconciliationEndpoint;
