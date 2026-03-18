const customerProperties = {
  id: { type: 'string' },
  phone: { type: 'string' },
  name: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
  lastLoginAt: { type: ['string', 'null'] },
};

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const requestOtpSchema = {
  description: 'Request an OTP code for customer phone authentication',
  tags: ['customer-auth'],
  body: {
    type: 'object',
    required: ['phone'],
    properties: {
      phone: { type: 'string', minLength: 10 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        // Only present in non-production environments
        otp: { type: 'string' },
      },
    },
    429: errorResponse,
  },
};

export const verifyOtpSchema = {
  description: 'Verify OTP and issue customer JWT',
  tags: ['customer-auth'],
  body: {
    type: 'object',
    required: ['phone', 'code'],
    properties: {
      phone: { type: 'string', minLength: 10 },
      code: { type: 'string', minLength: 6, maxLength: 6 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        customer: { type: 'object', properties: customerProperties },
      },
    },
    401: errorResponse,
    429: errorResponse,
  },
};

export const meSchema = {
  description: 'Get current authenticated customer',
  tags: ['customer-auth'],
  response: {
    200: {
      type: 'object',
      properties: {
        customer: { type: 'object', properties: customerProperties },
      },
    },
    401: errorResponse,
  },
};

export const logoutSchema = {
  description: 'Logout customer (clear cookie)',
  tags: ['customer-auth'],
  response: {
    200: {
      type: 'object',
      properties: { message: { type: 'string' } },
    },
  },
};

export const updateProfileSchema = {
  description: 'Update customer profile',
  tags: ['customer-auth'],
  body: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        customer: { type: 'object', properties: customerProperties },
      },
    },
    401: errorResponse,
  },
};
