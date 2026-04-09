// src/vendor-event/vendor-event.schema.ts

const vendorEventResponseProperties = {
  id: { type: 'string' },
  eventId: { type: 'string' },
  vendorId: { type: 'string' },
  qrCode: { type: 'string' },
  qrImage: { type: 'string' },
  menuTemplateId: { type: ['string', 'null'] },
  isDirect: { type: 'boolean' },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
};

const vendorEventWithDetailsProperties = {
  ...vendorEventResponseProperties,
  eventName: { type: 'string' },
  eventCode: { type: 'string' },
  startDate: { type: 'string' },
  endDate: { type: 'string' },
  status: { type: 'string' },
};

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const createVendorEventSchema = {
  description: 'Create a vendor lite event',
  tags: ['vendor-events'],
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      startDate: { type: 'string', format: 'date-time' },
      endDate: { type: 'string', format: 'date-time' },
      menuTemplateId: { type: 'string' },
    },
    required: ['name', 'startDate', 'endDate'],
  },
  response: {
    201: {
      type: 'object',
      properties: { vendorEvent: { type: 'object', properties: vendorEventResponseProperties } },
    },
    400: errorResponse,
    403: errorResponse,
    500: errorResponse,
  },
};

export const listVendorEventsSchema = {
  description: 'List all events created by this vendor',
  tags: ['vendor-events'],
  response: {
    200: {
      type: 'object',
      properties: {
        vendorEvents: {
          type: 'array',
          items: { type: 'object', properties: vendorEventWithDetailsProperties },
        },
      },
    },
    500: errorResponse,
  },
};

export const getVendorEventSchema = {
  description: 'Get a specific vendor event by ID',
  tags: ['vendor-events'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  response: {
    200: {
      type: 'object',
      properties: { vendorEvent: { type: 'object', properties: vendorEventWithDetailsProperties } },
    },
    404: errorResponse,
    500: errorResponse,
  },
};

export const updateVendorEventSchema = {
  description: 'Update a vendor event (name, dates)',
  tags: ['vendor-events'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      startDate: { type: 'string', format: 'date-time' },
      endDate: { type: 'string', format: 'date-time' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: { vendorEvent: { type: 'object', properties: vendorEventWithDetailsProperties } },
    },
    404: errorResponse,
    500: errorResponse,
  },
};

export const deleteVendorEventSchema = {
  description: 'Deactivate a vendor event',
  tags: ['vendor-events'],
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

export const getDirectQRSchema = {
  description: 'Generate or get the permanent direct QR code for this vendor',
  tags: ['vendor-events'],
  response: {
    200: {
      type: 'object',
      properties: { vendorEvent: { type: 'object', properties: vendorEventWithDetailsProperties } },
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
  },
};

export const updateDirectQRMenuSchema = {
  description: 'Swap the active menu template on the direct QR',
  tags: ['vendor-events'],
  body: {
    type: 'object',
    properties: {
      menuTemplateId: { type: ['string', 'null'] },
    },
    required: ['menuTemplateId'],
  },
  response: {
    200: {
      type: 'object',
      properties: { vendorEvent: { type: 'object', properties: vendorEventResponseProperties } },
    },
    404: errorResponse,
    500: errorResponse,
  },
};

export const getVendorEventQRSchema = {
  description: 'Re-download QR code for a vendor event',
  tags: ['vendor-events'],
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
