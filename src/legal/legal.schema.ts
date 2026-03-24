export const createDocumentSchema = {
  params: {
    type: 'object',
    required: ['slug'],
    properties: {
      slug: { type: 'string', pattern: '^[a-z0-9-]+$' },
    },
  },
  body: {
    type: 'object',
    required: ['title', 'content'],
    properties: {
      title: { type: 'string', minLength: 1 },
      content: { type: 'string', minLength: 1 },
    },
  },
} as const;

export const updateDocumentSchema = {
  params: {
    type: 'object',
    required: ['slug', 'version'],
    properties: {
      slug: { type: 'string' },
      version: { type: 'string', pattern: '^\\d+$' },
    },
  },
  body: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1 },
      content: { type: 'string', minLength: 1 },
    },
  },
} as const;

export const getDocumentSchema = {
  params: {
    type: 'object',
    required: ['slug'],
    properties: {
      slug: { type: 'string' },
    },
  },
} as const;

export const getHistorySchema = {
  params: {
    type: 'object',
    required: ['slug'],
    properties: {
      slug: { type: 'string' },
    },
  },
} as const;

export const publishSchema = {
  params: {
    type: 'object',
    required: ['slug'],
    properties: {
      slug: { type: 'string' },
    },
  },
  body: {
    type: 'object',
    properties: {
      version: { type: 'number' },
    },
  },
} as const;

export const acceptDocumentSchema = {
  params: {
    type: 'object',
    required: ['slug'],
    properties: {
      slug: { type: 'string' },
    },
  },
  body: {
    type: 'object',
    properties: {
      customer_phone: { type: 'string' },
    },
  },
} as const;

export const getAcceptancesSchema = {
  querystring: {
    type: 'object',
    properties: {
      slug: { type: 'string' },
      page: { type: 'string', pattern: '^\\d+$' },
      limit: { type: 'string', pattern: '^\\d+$' },
    },
  },
} as const;
