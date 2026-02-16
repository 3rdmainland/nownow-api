const userProperties = {
  id: { type: 'string' },
  vendorId: { type: 'string' },
  email: { type: 'string' },
  createdAt: { type: 'string' },
};

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const inviteSchema = {
  description: 'Create an invite for a vendor user',
  tags: ['auth'],
  body: {
    type: 'object',
    required: ['vendorId', 'email'],
    properties: {
      vendorId: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
    },
  },
  response: {
    201: {
      type: 'object',
      properties: {
        inviteToken: { type: 'string' },
        expiresAt: { type: 'string' },
      },
    },
    404: errorResponse,
    409: errorResponse,
  },
};

export const validateInviteSchema = {
  description: 'Validate an invite token',
  tags: ['auth'],
  params: {
    type: 'object',
    required: ['token'],
    properties: {
      token: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        vendorName: { type: 'string' },
      },
    },
    400: errorResponse,
    404: errorResponse,
  },
};

export const registerSchema = {
  description: 'Register a vendor user via invite token',
  tags: ['auth'],
  body: {
    type: 'object',
    required: ['token', 'password'],
    properties: {
      token: { type: 'string' },
      password: { type: 'string', minLength: 8 },
    },
  },
  response: {
    201: {
      type: 'object',
      properties: {
        user: { type: 'object', properties: userProperties },
      },
    },
    400: errorResponse,
    409: errorResponse,
  },
};

export const loginSchema = {
  description: 'Login vendor user',
  tags: ['auth'],
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        user: { type: 'object', properties: userProperties },
      },
    },
    401: errorResponse,
  },
};

export const meSchema = {
  description: 'Get current authenticated user',
  tags: ['auth'],
  response: {
    200: {
      type: 'object',
      properties: {
        user: { type: 'object', properties: userProperties },
      },
    },
    401: errorResponse,
  },
};

export const logoutSchema = {
  description: 'Logout vendor user',
  tags: ['auth'],
  response: {
    200: {
      type: 'object',
      properties: { message: { type: 'string' } },
    },
  },
};

export const changePasswordSchema = {
  description: 'Change password for authenticated vendor user',
  tags: ['auth'],
  body: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: { type: 'string' },
      newPassword: { type: 'string', minLength: 8 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: { message: { type: 'string' } },
    },
    401: errorResponse,
  },
};
