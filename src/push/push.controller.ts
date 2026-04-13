import type { FastifyPluginAsync } from 'fastify';
import { pushService } from './push.service.js';

const pushController: FastifyPluginAsync = async (fastify) => {
  // Register push subscription
  fastify.post('/subscribe', async (request, reply) => {
    const { userType, userId, subscription } = request.body as {
      userType: 'vendor' | 'customer' | 'admin';
      userId: string;
      subscription: {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
    };

    if (!userType || !userId || !subscription?.endpoint || !subscription?.keys) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    await pushService.subscribe({
      userType,
      userId,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    });

    return reply.status(201).send({ ok: true });
  });

  // Remove push subscription
  fastify.delete('/unsubscribe', async (request, reply) => {
    const { endpoint } = request.body as { endpoint: string };

    if (!endpoint) {
      return reply.status(400).send({ error: 'Missing endpoint' });
    }

    await pushService.unsubscribe(endpoint);
    return reply.status(200).send({ ok: true });
  });
};

export default pushController;
