const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const createBatchSchema = {
  description: 'Create a settlement batch from unsettled orders in date range',
  tags: ['settlement'],
  body: {
    type: 'object',
    required: ['startDate', 'endDate', 'payoutType'],
    properties: {
      startDate: { type: 'string' },
      endDate: { type: 'string' },
      payoutType: { type: 'string', enum: ['standard', 'instant'] },
      notes: { type: 'string' },
    },
  },
  response: {
    200: { type: 'object', additionalProperties: true },
    400: errorResponse,
  },
};

export const listBatchesSchema = {
  description: 'List settlement batches',
  tags: ['settlement'],
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['draft', 'processing', 'settled', 'failed'] },
      page: { type: 'number', default: 1 },
      limit: { type: 'number', default: 20 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        batches: { type: 'array' },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
};

export const getBatchSchema = {
  description: 'Get settlement batch with payouts',
  tags: ['settlement'],
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

export const processBatchSchema = {
  description: 'Process (dummy) a draft settlement batch',
  tags: ['settlement'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  response: {
    200: { type: 'object', additionalProperties: true },
    400: errorResponse,
    404: errorResponse,
  },
};

export const retryBatchSchema = {
  description: 'Retry a failed settlement batch',
  tags: ['settlement'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  response: {
    200: { type: 'object', additionalProperties: true },
    400: errorResponse,
    404: errorResponse,
  },
};

export const summarySchema = {
  description: 'Get settlement summary stats',
  tags: ['settlement'],
  response: {
    200: {
      type: 'object',
      properties: {
        totalBatches: { type: 'number' },
        totalSettled: { type: 'number' },
        totalPending: { type: 'number' },
        totalPayoutFees: { type: 'number' },
        totalFailed: { type: 'number' },
      },
    },
  },
};

export const vendorPayoutsSchema = {
  description: 'Get vendor payout history',
  tags: ['settlement'],
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
  },
};

export const upsertBankDetailsSchema = {
  description: 'Upsert vendor bank details',
  tags: ['settlement'],
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
  },
};

export const getBankDetailsSchema = {
  description: 'Get vendor bank details',
  tags: ['settlement'],
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
