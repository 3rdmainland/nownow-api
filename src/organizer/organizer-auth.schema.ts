const organizerUserProperties = {
  id: { type: 'string' },
  email: { type: 'string' },
  name: { type: 'string' },
  phone: { type: 'string', nullable: true },
  organization: { type: 'string', nullable: true },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
};

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const organizerInviteSchema = {
  description: 'Create an invite for an organizer',
  tags: ['organizer-auth'],
  body: {
    type: 'object',
    required: ['email'],
    properties: {
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
    409: errorResponse,
  },
};

export const organizerValidateInviteSchema = {
  description: 'Validate an organizer invite token',
  tags: ['organizer-auth'],
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
      },
    },
    400: errorResponse,
    404: errorResponse,
  },
};

export const organizerRegisterSchema = {
  description: 'Register an organizer via invite token',
  tags: ['organizer-auth'],
  body: {
    type: 'object',
    required: ['token', 'password', 'name'],
    properties: {
      token: { type: 'string' },
      password: { type: 'string', minLength: 8 },
      name: { type: 'string', minLength: 1 },
    },
  },
  response: {
    201: {
      type: 'object',
      properties: {
        user: { type: 'object', properties: organizerUserProperties },
      },
    },
    400: errorResponse,
    409: errorResponse,
  },
};

export const organizerLoginSchema = {
  description: 'Login organizer',
  tags: ['organizer-auth'],
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
        user: { type: 'object', properties: organizerUserProperties },
      },
    },
    401: errorResponse,
    429: errorResponse,
  },
};

export const organizerLogoutSchema = {
  description: 'Logout organizer',
  tags: ['organizer-auth'],
  response: {
    200: {
      type: 'object',
      properties: { message: { type: 'string' } },
    },
  },
};

export const organizerForgotPasswordSchema = {
  description: 'Request a password reset link',
  tags: ['organizer-auth'],
  body: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: { message: { type: 'string' } },
    },
  },
};

export const organizerResetPasswordSchema = {
  description: 'Reset password using a reset token',
  tags: ['organizer-auth'],
  body: {
    type: 'object',
    required: ['token', 'newPassword'],
    properties: {
      token: { type: 'string' },
      newPassword: { type: 'string', minLength: 8 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: { message: { type: 'string' } },
    },
    400: errorResponse,
    404: errorResponse,
  },
};

export const organizerChangePasswordSchema = {
  description: 'Change password for authenticated organizer',
  tags: ['organizer-auth'],
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

export const organizerAdminResetPasswordSchema = {
  description: 'Admin-initiated password reset for an organizer',
  tags: ['organizer-auth'],
  body: {
    type: 'object',
    required: ['email', 'newPassword'],
    properties: {
      email: { type: 'string', format: 'email' },
      newPassword: { type: 'string', minLength: 8 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: { message: { type: 'string' } },
    },
    401: errorResponse,
    404: errorResponse,
  },
};

export const organizerMeSchema = {
  description: 'Get current authenticated organizer',
  tags: ['organizer-auth'],
  response: {
    200: {
      type: 'object',
      properties: {
        user: { type: 'object', properties: organizerUserProperties },
      },
    },
    401: errorResponse,
  },
};

export const organizerUpdateProfileSchema = {
  description: 'Update organizer profile',
  tags: ['organizer-auth'],
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      phone: { type: 'string' },
      organization: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        user: { type: 'object', properties: organizerUserProperties },
      },
    },
    401: errorResponse,
  },
};
