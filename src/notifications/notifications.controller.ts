import { FastifyPluginAsync } from 'fastify';
import { authenticateAdmin } from '../lib/auth.js';
import { NotificationService } from './notifications.service.js';
import { AdminJwtPayload } from '../admin-auth/admin-auth.types.js';
import { AdminService } from '../admin/admin.service.js';
import { sendNotificationSchema, sentNotificationsSchema } from './notifications.schema.js';
import { SendNotificationPayload } from './notifications.types.js';

const adminNotificationController: FastifyPluginAsync = async (fastify) => {
  const notificationService = new NotificationService();
  const adminService = new AdminService();

  fastify.addHook('onRequest', authenticateAdmin);

  // POST / — send a notification
  fastify.post<{ Body: SendNotificationPayload }>('/', { schema: sendNotificationSchema }, async (request, reply) => {
    try {
      const admin = request.user as AdminJwtPayload;
      const payload = request.body;

      // Validate targeted sends have a target user
      if ((payload.audience === 'vendor' || payload.audience === 'organizer') && !payload.targetUserId) {
        return reply.status(400).send({ error: 'targetUserId is required for targeted notifications' });
      }

      const result = await notificationService.sendNotification(payload, admin.userId);

      await adminService.logAction(
        admin.userId,
        'send_notification',
        'notification',
        result.id,
        { title: payload.title, audience: payload.audience, recipientCount: result.recipientCount },
      );

      return reply.status(201).send(result);
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to send notification' });
    }
  });

  // GET / — list sent notifications (admin view)
  fastify.get('/', { schema: sentNotificationsSchema }, async (request, reply) => {
    try {
      const { page = 1, limit = 20, audience } = request.query as { page?: number; limit?: number; audience?: string };
      return notificationService.getSentNotifications({ page, limit, audience });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch notifications' });
    }
  });
};

export default adminNotificationController;
