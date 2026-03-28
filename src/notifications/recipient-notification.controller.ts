import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { NotificationService } from './notifications.service.js';
import {
  recipientNotificationsSchema,
  unreadCountSchema,
  markReadSchema,
  markAllReadSchema,
} from './notifications.schema.js';

interface JwtUser {
  userId: string;
  role: 'vendor' | 'organizer';
}

const recipientNotificationController: FastifyPluginAsync = async (fastify) => {
  const notificationService = new NotificationService();

  fastify.addHook('onRequest', authenticate);

  // GET / — list notifications for authenticated user
  fastify.get('/', { schema: recipientNotificationsSchema }, async (request, reply) => {
    try {
      const user = request.user as JwtUser;
      const { page = 1, limit = 20, unreadOnly = false } = request.query as {
        page?: number;
        limit?: number;
        unreadOnly?: boolean;
      };

      return notificationService.getRecipientNotifications(user.userId, user.role, {
        page,
        limit,
        unreadOnly,
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch notifications' });
    }
  });

  // GET /unread-count — lightweight unread count for bell badge
  fastify.get('/unread-count', { schema: unreadCountSchema }, async (request, reply) => {
    try {
      const user = request.user as JwtUser;
      const unreadCount = await notificationService.getUnreadCount(user.userId, user.role);
      return { unreadCount };
    } catch (err: any) {
      fastify.log.error(err);
      return (reply as any).status(500).send({ error: 'Failed to fetch unread count' });
    }
  });

  // PATCH /:id/read — mark single notification as read
  fastify.patch<{ Params: { id: string } }>('/:id/read', { schema: markReadSchema }, async (request, reply) => {
    try {
      const user = request.user as JwtUser;
      await notificationService.markAsRead(request.params.id, user.userId, user.role);
      return reply.status(200).send({ message: 'Marked as read' });
    } catch (err: any) {
      if (err.message === 'Notification not found') {
        return reply.status(404).send({ error: err.message });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to mark notification as read' });
    }
  });

  // PATCH /read-all — mark all as read
  fastify.patch('/read-all', { schema: markAllReadSchema }, async (request, reply) => {
    try {
      const user = request.user as JwtUser;
      const count = await notificationService.markAllAsRead(user.userId, user.role);
      return { message: 'All notifications marked as read', count };
    } catch (err: any) {
      fastify.log.error(err);
      return (reply as any).status(500).send({ error: 'Failed to mark all as read' });
    }
  });
};

export default recipientNotificationController;
