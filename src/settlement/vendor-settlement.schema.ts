const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const vendorGetBankDetailsSchema = {
  description: 'Get own bank details',
  tags: ['vendor-settlement'],
  params: {
    type: 'object',
    required: ['vendorId'],
    properties: { vendorId: { type: 'string' } },
  },
  response: {
    200: { type: 'object', additionalProperties: true },
    404: errorResponse,
  },
};

export const vendorUpsertBankDetailsSchema = {
  description: 'Save/update own bank details',
  tags: ['vendor-settlement'],
  params: {
    type: 'object',
    required: ['vendorId'],
    properties: { vendorId: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['accountHolderName', 'bankName', 'accountNumber', 'branchCode', 'accountType'],
    properties: {
      accountHolderName: { type: 'string', minLength: 1 },
      bankName: { type: 'string', minLength: 1 },
      accountNumber: { type: 'string', minLength: 1 },
      branchCode: { type: 'string', minLength: 1 },
      accountType: { type: 'string', enum: ['cheque', 'savings', 'transmission', 'current'] },
    },
  },
  response: {
    200: { type: 'object', additionalProperties: true },
    400: errorResponse,
    403: errorResponse,
  },
};

export const vendorPayoutsSchema = {
  description: 'Get own payout history',
  tags: ['vendor-settlement'],
  params: {
    type: 'object',
    required: ['vendorId'],
    properties: { vendorId: { type: 'string' } },
  },
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'number', default: 1 },
      limit: { type: 'number', default: 20 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        payouts: { type: 'array' },
        total: { type: 'number' },
      },
    },
    403: errorResponse,
  },
};

export const vendorAgreementsSchema = {
  description: 'Get own agreements',
  tags: ['vendor-settlement'],
  params: {
    type: 'object',
    required: ['vendorId'],
    properties: { vendorId: { type: 'string' } },
  },
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string' },
    },
  },
  response: {
    200: { type: 'array', items: { type: 'object', additionalProperties: true } },
    403: errorResponse,
  },
};

export const vendorAcceptAgreementSchema = {
  description: 'Accept a draft agreement',
  tags: ['vendor-settlement'],
  params: {
    type: 'object',
    required: ['vendorId', 'id'],
    properties: {
      vendorId: { type: 'string' },
      id: { type: 'string' },
    },
  },
  response: {
    200: { type: 'object', additionalProperties: true },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
  },
};

export const vendorSummarySchema = {
  description: 'Get own settlement summary',
  tags: ['vendor-settlement'],
  params: {
    type: 'object',
    required: ['vendorId'],
    properties: { vendorId: { type: 'string' } },
  },
  response: {
    200: { type: 'object', additionalProperties: true },
    403: errorResponse,
  },
};
