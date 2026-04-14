// src/stall/stall.schema.ts

const stallResponseProperties = {
  id: { type: 'string' },
  eventId: { type: 'string' },
  vendorId: { type: 'string' },
  qrCode: { type: 'string' },
  qrImage: { type: 'string' },
  menuTemplateId: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
};

const stallWithDetailsProperties = {
  ...stallResponseProperties,
  eventName: { type: 'string' },
  eventCode: { type: 'string' },
  startDate: { type: 'string' },
  endDate: { type: 'string' },
  eventStatus: { type: 'string' },
  boothInfo: { type: ['string', 'null'] },
};

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const createStallSchema = {
  description: 'Create a stall at an organizer event',
  tags: ['stalls'],
  body: {
    type: 'object',
    properties: {
      eventId: { type: 'string' },
      menuTemplateId: { type: 'string' },
      allowPayAtStall: { type: 'boolean' },
      boothInfo: { type: 'string', maxLength: 255 },
    },
    required: ['eventId'],
  },
  response: {
    201: {
      type: 'object',
      properties: { stall: { type: 'object', properties: stallResponseProperties } },
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    500: errorResponse,
  },
};

export const listStallsSchema = {
  description: 'List all stalls for this vendor',
  tags: ['stalls'],
  response: {
    200: {
      type: 'object',
      properties: {
        stalls: {
          type: 'array',
          items: { type: 'object', properties: stallWithDetailsProperties },
        },
      },
    },
    500: errorResponse,
  },
};

export const getStallSchema = {
  description: 'Get a specific stall by ID',
  tags: ['stalls'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  response: {
    200: {
      type: 'object',
      properties: { stall: { type: 'object', properties: stallWithDetailsProperties } },
    },
    404: errorResponse,
    500: errorResponse,
  },
};

export const updateStallSchema = {
  description: 'Update a stall (menu template, booth info, pay at stall)',
  tags: ['stalls'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  body: {
    type: 'object',
    properties: {
      menuTemplateId: { type: ['string', 'null'] },
      boothInfo: { type: ['string', 'null'], maxLength: 255 },
      allowPayAtStall: { type: 'boolean' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: { stall: { type: 'object', properties: stallWithDetailsProperties } },
    },
    404: errorResponse,
    500: errorResponse,
  },
};

export const deleteStallSchema = {
  description: 'Delete a stall',
  tags: ['stalls'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  response: {
    204: { type: 'null' },
    404: errorResponse,
    500: errorResponse,
  },
};

export const getStallQRSchema = {
  description: 'Get the QR code for a stall',
  tags: ['stalls'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  response: {
    200: {
      type: 'object',
      properties: {
        qrCode: { type: 'string' },
        qrImage: { type: 'string' },
      },
    },
    404: errorResponse,
    500: errorResponse,
  },
};

export const listInvitedEventsSchema = {
  description: 'List organizer events this vendor has been invited to',
  tags: ['stalls'],
  response: {
    200: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              code: { type: 'string' },
              startDate: { type: 'string' },
              endDate: { type: 'string' },
              status: { type: 'string' },
            },
          },
        },
      },
    },
    500: errorResponse,
  },
};
