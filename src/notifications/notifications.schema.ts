export const sendNotificationSchema = {
  body: {
    type: 'object',
    required: ['title', 'message', 'type', 'audience'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      message: { type: 'string', minLength: 1, maxLength: 2000 },
      type: { type: 'string', enum: ['info', 'warning', 'success', 'action'] },
      actionUrl: { type: 'string', maxLength: 500, pattern: '^(\\/|https:\\/\\/)' },
      audience: { type: 'string', enum: ['all', 'all_vendors', 'all_organizers', 'vendor', 'organizer'] },
      targetUserId: { type: 'string', format: 'uuid' },
    },
  },
};

export const sentNotificationsSchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      audience: { type: 'string', enum: ['all', 'all_vendors', 'all_organizers', 'vendor', 'organizer'] },
    },
  },
};

export const recipientNotificationsSchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      unreadOnly: { type: 'boolean', default: false },
    },
  },
};

export const unreadCountSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        unreadCount: { type: 'integer' },
      },
    },
  },
};

export const markReadSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
};

export const markAllReadSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        count: { type: 'integer' },
      },
    },
  },
};
