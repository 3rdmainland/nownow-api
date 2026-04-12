const adminUserProperties = {
  id: { type: 'string' },
  email: { type: 'string' },
  name: { type: 'string' },
  isActive: { type: 'boolean' },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
};

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const adminLoginSchema = {
  description: 'Login admin user',
  tags: ['admin-auth'],
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
        user: { type: 'object', properties: adminUserProperties },
      },
    },
    401: errorResponse,
    429: errorResponse,
  },
};

export const adminLogoutSchema = {
  description: 'Logout admin user',
  tags: ['admin-auth'],
  response: {
    200: {
      type: 'object',
      properties: { message: { type: 'string' } },
    },
  },
};

export const adminMeSchema = {
  description: 'Get current authenticated admin user',
  tags: ['admin-auth'],
  response: {
    200: {
      type: 'object',
      properties: {
        user: { type: 'object', properties: adminUserProperties },
      },
    },
    401: errorResponse,
  },
};

export const adminChangePasswordSchema = {
  description: 'Change password for authenticated admin',
  tags: ['admin-auth'],
  body: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: { type: 'string' },
      newPassword: { type: 'string', minLength: 8, pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^a-zA-Z\\d]).{8,}$' },
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
