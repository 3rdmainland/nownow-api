import { FastifyPluginAsync } from 'fastify';
import { Receiver } from '@upstash/qstash';
import { processOrganizerEmails } from './organizer-email.service.js';

const receiver = (process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)
  ? new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    })
  : null;

const organizerEmailEndpoint: FastifyPluginAsync = async (fastify) => {
  fastify.post('/run', async (request, reply) => {
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

    try {
      const result = await processOrganizerEmails();
      return { success: true, ...result };
    } catch (err: any) {
      console.error('Organizer email endpoint error:', err.message);
      return reply.status(500).send({ error: err.message });
    }
  });
};

export default organizerEmailEndpoint;
