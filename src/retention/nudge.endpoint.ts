import { FastifyPluginAsync } from 'fastify';
import { Receiver } from '@upstash/qstash';
import { processNudge } from './nudge.processor.js';

const receiver = (process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)
  ? new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    })
  : null;

/**
 * Internal endpoint called by QStash to process a single nudge.
 * NOT a public API — only QStash should call this (verified via signature).
 */
const nudgeEndpoint: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: { nudgeId: string } }>(
    '/send',
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

      // 2. Process the nudge
      const { nudgeId } = request.body;
      if (!nudgeId) {
        return reply.status(400).send({ error: 'Missing nudgeId' });
      }

      try {
        const result = await processNudge(nudgeId);
        return { success: true, ...result };
      } catch (err: any) {
        // Return 500 so QStash retries
        console.error('Nudge endpoint error:', err.message);
        return reply.status(500).send({ error: err.message });
      }
    },
  );
};

export default nudgeEndpoint;
