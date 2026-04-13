import { FastifyPluginAsync } from 'fastify';
import { Receiver } from '@upstash/qstash';
import { OrderService } from './order.service.js';
import { supabase } from '../lib/supabase.js';

const receiver = (process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)
  ? new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    })
  : null;

/**
 * Internal endpoint called by QStash (or cron) to clean up stale PAYMENT_PENDING orders.
 * Cancels orders that have been in PAYMENT_PENDING for more than 15 minutes
 * and decrements the active order counters.
 *
 * Set up a QStash schedule to POST to this every 5 minutes.
 */
const orderCleanupEndpoint: FastifyPluginAsync = async (fastify) => {
  fastify.post('/stale-orders', async (request, reply) => {
    // Verify QStash signature in production
    if (receiver) {
      try {
        const signature = request.headers['upstash-signature'] as string;
        if (!signature) {
          return reply.status(401).send({ error: 'Missing QStash signature' });
        }
        const rawBody = JSON.stringify(request.body);
        const isValid = await receiver.verify({ signature, body: rawBody });
        if (!isValid) {
          return reply.status(401).send({ error: 'Invalid QStash signature' });
        }
      } catch {
        return reply.status(401).send({ error: 'Signature verification failed' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      return reply.status(500).send({ error: 'QStash signing keys not configured' });
    }

    const orderService = new OrderService();
    const cleaned = await orderService.cleanupStalePaymentPending(15);

    // Mark READY orders as UNCOLLECTED after 30 minutes
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: expired } = await supabase
      .from('orders')
      .select('id, vendor_id, event_id')
      .eq('status', 'READY')
      .lt('ready_at', thirtyMinAgo);

    let uncollected = 0;
    if (expired?.length) {
      await supabase
        .from('orders')
        .update({ status: 'UNCOLLECTED', updated_at: new Date().toISOString() })
        .eq('status', 'READY')
        .lt('ready_at', thirtyMinAgo);
      uncollected = expired.length;
    }

    return { cleaned, uncollected };
  });
};

export default orderCleanupEndpoint;
