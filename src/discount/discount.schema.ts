const errorResponse = {
    type: 'object',
    properties: { error: { type: 'string' } },
};

const discountProperties = {
    id: { type: 'string' },
    eventId: { type: 'string' },
    vendorId: { type: 'string', nullable: true },
    scope: { type: 'string', enum: ['EVENT', 'ITEM'] },
    targetItemIds: { type: 'array', items: { type: 'string' }, nullable: true },
    type: { type: 'string', enum: ['PERCENTAGE', 'FIXED'] },
    value: { type: 'number' },
    isActive: { type: 'boolean' },
    createdBy: { type: 'string', enum: ['ORGANIZER', 'VENDOR'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
};

export const createVendorDiscountSchema = {
    description: 'Create a discount for a vendor at an event',
    tags: ['discount'],
    params: {
        type: 'object',
        required: ['vendorId', 'eventId'],
        properties: {
            vendorId: { type: 'string', format: 'uuid' },
            eventId: { type: 'string', format: 'uuid' },
        },
    },
    body: {
        type: 'object',
        required: ['scope', 'type', 'value'],
        properties: {
            scope: { type: 'string', enum: ['EVENT', 'ITEM'] },
            targetItemIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
            type: { type: 'string', enum: ['PERCENTAGE', 'FIXED'] },
            value: { type: 'number', minimum: 0.01 },
        },
    },
    response: {
        201: { type: 'object', properties: discountProperties },
        400: errorResponse,
    },
};

export const listVendorDiscountsSchema = {
    description: 'List discounts for a vendor at an event',
    tags: ['discount'],
    params: {
        type: 'object',
        required: ['vendorId', 'eventId'],
        properties: {
            vendorId: { type: 'string', format: 'uuid' },
            eventId: { type: 'string', format: 'uuid' },
        },
    },
    response: {
        200: { type: 'array', items: { type: 'object', properties: discountProperties } },
    },
};

export const createOrganizerDiscountSchema = {
    description: 'Create an event-wide discount (organizer)',
    tags: ['discount'],
    params: {
        type: 'object',
        required: ['eventId'],
        properties: {
            eventId: { type: 'string', format: 'uuid' },
        },
    },
    body: {
        type: 'object',
        required: ['type', 'value'],
        properties: {
            type: { type: 'string', enum: ['PERCENTAGE', 'FIXED'] },
            value: { type: 'number', minimum: 0.01 },
        },
    },
    response: {
        201: { type: 'object', properties: discountProperties },
        400: errorResponse,
    },
};

export const listOrganizerDiscountsSchema = {
    description: 'List all discounts for an event (organizer view)',
    tags: ['discount'],
    params: {
        type: 'object',
        required: ['eventId'],
        properties: {
            eventId: { type: 'string', format: 'uuid' },
        },
    },
    response: {
        200: { type: 'array', items: { type: 'object', properties: discountProperties } },
    },
};

export const updateDiscountSchema = {
    description: 'Update a discount',
    tags: ['discount'],
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: { type: 'string', format: 'uuid' },
        },
    },
    body: {
        type: 'object',
        properties: {
            scope: { type: 'string', enum: ['EVENT', 'ITEM'] },
            targetItemIds: { type: 'array', items: { type: 'string', format: 'uuid' }, nullable: true },
            type: { type: 'string', enum: ['PERCENTAGE', 'FIXED'] },
            value: { type: 'number', minimum: 0.01 },
            isActive: { type: 'boolean' },
        },
    },
    response: {
        200: { type: 'object', properties: discountProperties },
        403: errorResponse,
        404: errorResponse,
    },
};

export const deleteDiscountSchema = {
    description: 'Delete a discount',
    tags: ['discount'],
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: { type: 'string', format: 'uuid' },
        },
    },
    response: {
        200: { type: 'object', properties: { message: { type: 'string' } } },
        403: errorResponse,
        404: errorResponse,
    },
};
