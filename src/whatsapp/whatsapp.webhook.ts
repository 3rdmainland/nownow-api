import { FastifyPluginAsync } from 'fastify';
import { WhatsAppLogger } from './whatsapp.logger.js';

interface WebhookVerifyQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

interface WebhookBody {
  object?: string;
  entry?: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product?: string;
        statuses?: Array<{
          id: string; // wa_message_id
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id: string;
        }>;
      };
      field: string;
    }>;
  }>;
}

const whatsappWebhook: FastifyPluginAsync = async (fastify) => {
  const logger = new WhatsAppLogger();

  // Meta webhook verification (GET)
  fastify.get<{ Querystring: WebhookVerifyQuery }>(
    '/',
    async (request, reply) => {
      const mode = request.query['hub.mode'];
      const token = request.query['hub.verify_token'];
      const challenge = request.query['hub.challenge'];

      const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN;

      if (mode === 'subscribe' && token === verifyToken) {
        console.log('WhatsApp webhook verified');
        return reply.status(200).send(challenge);
      }

      return reply.status(403).send({ error: 'Forbidden' });
    },
  );

  // Meta delivery status webhook (POST)
  fastify.post<{ Body: WebhookBody }>(
    '/',
    async (request, reply) => {
      const body = request.body;

      // Always return 200 quickly — Meta retries on non-2xx
      reply.status(200).send({ status: 'ok' });

      // Process status updates in background
      if (body?.object !== 'whatsapp_business_account') return;

      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field !== 'messages') continue;
          for (const status of change.value.statuses ?? []) {
            void logger
              .updateStatus(status.id, status.status)
              .catch((err) =>
                console.error('Webhook status update failed:', (err as Error).message),
              );
          }
        }
      }
    },
  );
};

export default whatsappWebhook;
