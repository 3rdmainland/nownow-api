const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const settlementOverviewSchema = {
  description: 'Get organizer settlement overview across all events',
  tags: ['organizer'],
  response: {
    200: { type: 'object', additionalProperties: true },
  },
};

export const eventVendorBreakdownSchema = {
  description: 'Get per-vendor breakdown for a specific event',
  tags: ['organizer'],
  params: {
    type: 'object',
    required: ['eventId'],
    properties: { eventId: { type: 'string' } },
  },
  response: {
    200: { type: 'array', items: { type: 'object', additionalProperties: true } },
    403: errorResponse,
    404: errorResponse,
  },
};

export const platformTermsSchema = {
  description: 'Get platform fee and payout terms',
  tags: ['organizer'],
  response: {
    200: { type: 'object', additionalProperties: true },
  },
};

export const listAgreementsSchema = {
  description: 'List organizer vendor agreements',
  tags: ['organizer'],
  querystring: {
    type: 'object',
    properties: {
      eventId: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'active', 'expired'] },
    },
  },
  response: {
    200: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
};

export const getAgreementSchema = {
  description: 'Get single agreement by ID',
  tags: ['organizer'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  response: {
    200: { type: 'object', additionalProperties: true },
    404: errorResponse,
  },
};

export const createAgreementSchema = {
  description: 'Create a vendor commission agreement',
  tags: ['organizer'],
  body: {
    type: 'object',
    required: ['vendorId', 'eventId', 'commissionRate', 'effectiveFrom'],
    properties: {
      vendorId: { type: 'string' },
      eventId: { type: 'string' },
      commissionRate: { type: 'number', minimum: 0, maximum: 100 },
      effectiveFrom: { type: 'string' },
      effectiveUntil: { type: 'string' },
      notes: { type: 'string' },
    },
  },
  response: {
    200: { type: 'object', additionalProperties: true },
    400: errorResponse,
    409: errorResponse,
  },
};

export const updateAgreementSchema = {
  description: 'Update a vendor commission agreement',
  tags: ['organizer'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    properties: {
      commissionRate: { type: 'number', minimum: 0, maximum: 100 },
      status: { type: 'string', enum: ['draft', 'active', 'expired'] },
      effectiveFrom: { type: 'string' },
      effectiveUntil: { type: ['string', 'null'] },
      notes: { type: ['string', 'null'] },
    },
  },
  response: {
    200: { type: 'object', additionalProperties: true },
    403: errorResponse,
    404: errorResponse,
  },
};

export const deleteAgreementSchema = {
  description: 'Delete a draft agreement',
  tags: ['organizer'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  response: {
    204: { type: 'null' },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
  },
};
