const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

const categoryEnum = ['ORDER_ISSUE', 'ACCOUNT_ISSUE', 'PAYMENT_ISSUE', 'GENERAL_INQUIRY', 'VENDOR_COMPLAINT', 'EVENT_ISSUE'];
const priorityEnum = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

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

export const customerListTicketsSchema = {
  description: 'List tickets for the authenticated customer',
  tags: ['customer-support'],
  response: {
    200: {
      type: 'array',
      items: { type: 'object', properties: ticketProperties },
    },
  },
};

export const customerGetTicketSchema = {
  description: 'Get a ticket by ID for the authenticated customer',
  tags: ['customer-support'],
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

export const customerCreateTicketSchema = {
  description: 'Create a support ticket as a customer',
  tags: ['customer-support'],
  body: {
    type: 'object',
    required: ['subject', 'description', 'category', 'priority'],
    properties: {
      subject: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      category: { type: 'string', enum: categoryEnum },
      priority: { type: 'string', enum: priorityEnum },
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

const guestCategoryEnum = ['ACCOUNT_ISSUE', 'GENERAL_INQUIRY', 'EVENT_ISSUE'];

export const customerCreateGuestTicketSchema = {
  description: 'Create a support ticket as an unauthenticated guest (non-order issues only)',
  tags: ['customer-support'],
  body: {
    type: 'object',
    required: ['subject', 'description', 'category'],
    properties: {
      subject: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      category: { type: 'string', enum: guestCategoryEnum },
      priority: { type: 'string', enum: priorityEnum },
      eventId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    201: { type: 'object', properties: ticketProperties },
    400: errorResponse,
    429: errorResponse,
  },
};

export const customerAddMessageSchema = {
  description: 'Add a message to a ticket as a customer',
  tags: ['customer-support'],
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
    201: { type: 'object', properties: messageProperties },
    404: errorResponse,
  },
};
