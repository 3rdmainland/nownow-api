const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

const categoryEnum = ['ORDER_ISSUE', 'ACCOUNT_ISSUE', 'PAYMENT_ISSUE', 'GENERAL_INQUIRY', 'VENDOR_COMPLAINT', 'EVENT_ISSUE'];
const priorityEnum = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const statusEnum = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

const ticketProperties = {
  id: { type: 'string' },
  ticketNumber: { type: 'number' },
  subject: { type: 'string' },
  description: { type: 'string' },
  category: { type: 'string' },
  priority: { type: 'string' },
  status: { type: 'string' },
  source: { type: 'string' },
  customerPhone: { type: ['string', 'null'] },
  orderId: { type: ['string', 'null'] },
  eventId: { type: ['string', 'null'] },
  vendorId: { type: ['string', 'null'] },
  assignedAdminId: { type: ['string', 'null'] },
  assignedAdminName: { type: ['string', 'null'] },
  resolvedAt: { type: ['string', 'null'] },
  closedAt: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
};

const messageProperties = {
  id: { type: 'string' },
  ticketId: { type: 'string' },
  senderType: { type: 'string' },
  senderId: { type: ['string', 'null'] },
  senderName: { type: ['string', 'null'] },
  message: { type: 'string' },
  isInternal: { type: 'boolean' },
  createdAt: { type: 'string' },
};

export const listTicketsSchema = {
  description: 'List support tickets with filters and pagination',
  tags: ['support'],
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: statusEnum },
      priority: { type: 'string', enum: priorityEnum },
      category: { type: 'string', enum: categoryEnum },
      assignedAdminId: { type: 'string', format: 'uuid' },
      search: { type: 'string' },
      page: { type: 'number', default: 1 },
      limit: { type: 'number', default: 20 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        tickets: { type: 'array', items: { type: 'object', properties: ticketProperties } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
};

export const getTicketSchema = {
  description: 'Get a support ticket by ID with messages',
  tags: ['support'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ...ticketProperties,
        messages: { type: 'array', items: { type: 'object', properties: messageProperties } },
      },
    },
    404: errorResponse,
  },
};

export const createTicketSchema = {
  description: 'Create a new support ticket',
  tags: ['support'],
  body: {
    type: 'object',
    required: ['subject', 'description', 'category'],
    properties: {
      subject: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      category: { type: 'string', enum: categoryEnum },
      priority: { type: 'string', enum: priorityEnum },
      source: { type: 'string', enum: ['CUSTOMER', 'VENDOR', 'ADMIN'] },
      customerPhone: { type: 'string' },
      orderId: { type: 'string', format: 'uuid' },
      eventId: { type: 'string', format: 'uuid' },
      vendorId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    201: { type: 'object', properties: ticketProperties },
    400: errorResponse,
  },
};

export const updateTicketSchema = {
  description: 'Update a support ticket',
  tags: ['support'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    properties: {
      subject: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      category: { type: 'string', enum: categoryEnum },
      priority: { type: 'string', enum: priorityEnum },
      status: { type: 'string', enum: statusEnum },
      assignedAdminId: { type: ['string', 'null'] },
    },
  },
  response: {
    200: { type: 'object', properties: ticketProperties },
    404: errorResponse,
  },
};

export const addMessageSchema = {
  description: 'Add a message to a support ticket',
  tags: ['support'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string', minLength: 1 },
      isInternal: { type: 'boolean', default: false },
    },
  },
  response: {
    201: { type: 'object', properties: messageProperties },
    404: errorResponse,
  },
};

export const resolveTicketSchema = {
  description: 'Resolve a support ticket',
  tags: ['support'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string', minLength: 1 },
    },
  },
  response: {
    200: { type: 'object', properties: ticketProperties },
    404: errorResponse,
  },
};

export const closeTicketSchema = {
  description: 'Close a support ticket',
  tags: ['support'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: { type: 'object', properties: ticketProperties },
    404: errorResponse,
  },
};

export const supportStatsSchema = {
  description: 'Get support ticket statistics',
  tags: ['support'],
  response: {
    200: {
      type: 'object',
      properties: {
        open: { type: 'number' },
        inProgress: { type: 'number' },
        resolved: { type: 'number' },
        closed: { type: 'number' },
        unassigned: { type: 'number' },
        urgent: { type: 'number' },
        avgResolutionHours: { type: ['number', 'null'] },
        byCategory: { type: 'object', additionalProperties: { type: 'number' } },
      },
    },
  },
};
