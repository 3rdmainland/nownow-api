export const grantConsentSchema = {
  body: {
    type: 'object',
    required: ['eventId', 'consentType'],
    properties: {
      eventId: { type: 'string' },
      consentType: { type: 'string', enum: ['marketing', 'transactional'] },
    },
  },
} as const;

export const revokeConsentSchema = {
  body: {
    type: 'object',
    required: ['eventId', 'consentType'],
    properties: {
      eventId: { type: 'string' },
      consentType: { type: 'string', enum: ['marketing', 'transactional'] },
    },
  },
} as const;

export const getConsentSchema = {
  params: {
    type: 'object',
    required: ['eventId'],
    properties: {
      eventId: { type: 'string' },
    },
  },
} as const;
