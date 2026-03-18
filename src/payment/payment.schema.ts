export const webhookSchema = {
    description: 'Stitch payment webhook',
    tags: ['payment'],
    body: {
        type: 'object',
        // Webhook body is validated by signature, not schema — keep loose
    },
    response: {
        200: {
            type: 'object',
            properties: {
                received: { type: 'boolean' },
            },
        },
    },
};

export const paymentStatusSchema = {
    description: 'Get payment status for an order',
    tags: ['payment'],
    params: {
        type: 'object',
        properties: {
            orderId: { type: 'string' },
        },
        required: ['orderId'],
    },
    response: {
        200: {
            type: 'object',
            properties: {
                orderId: { type: 'string' },
                paymentStatus: { type: 'string' },
                orderStatus: { type: 'string' },
            },
        },
    },
};
