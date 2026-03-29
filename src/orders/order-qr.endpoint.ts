import { FastifyPluginAsync } from 'fastify';
import { Receiver } from '@upstash/qstash';
import { QRHelper } from '../lib/qr.helper.js';
import { supabase } from '../lib/supabase.js';
import { broadcastToPhone } from '../websocket/index.js';

const receiver = (process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)
  ? new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    })
  : null;

/**
 * Internal endpoint called by QStash to generate QR codes in the background.
 * NOT a public API — only QStash should call this (verified via signature).
 */
const orderQrEndpoint: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: { orderId: string } }>(
    '/generate',
    async (request, reply) => {
      // 1. Verify QStash signature in production
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

      // 2. Generate QR code
      const { orderId } = request.body;
      if (!orderId) {
        return reply.status(400).send({ error: 'Missing orderId' });
      }

      try {
        const qrHelper = new QRHelper();
        const { qr_code, qr_image } = await qrHelper.generateAndUploadQRCode(orderId);

        // 3. Update order with QR code data
        const { data: order, error: updateError } = await supabase
          .from('orders')
          .update({ qr_code, qr_image })
          .eq('id', orderId)
          .select('id, phone')
          .single();

        if (updateError) {
          throw new Error(`Failed to update order with QR code: ${updateError.message}`);
        }

        // 4. Notify the customer via WebSocket that QR is ready
        if (order?.phone) {
          broadcastToPhone(order.phone, {
            type: 'QR_READY',
            payload: { orderId, qrCode: qr_code, qrImage: qr_image },
            timestamp: new Date().toISOString(),
          });
        }

        return { success: true, orderId };
      } catch (err: any) {
        console.error('QR generation endpoint error:', err.message);
        return reply.status(500).send({ error: err.message });
      }
    },
  );
};

export default orderQrEndpoint;
