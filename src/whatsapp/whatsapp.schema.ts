import { FastifySchema } from "fastify";

// Shared response schemas
const successResponse = {
    type: "object",
    properties: {
        success: { const: true }
    },
    required: ["success"]
} as const;

const errorResponse = {
    type: "object",
    properties: {
        error: { type: "string" }
    },
    required: ["error"]
} as const;

// Request body types
export interface SendWhatsAppMessageBody {
    to: string;
    message: string;
}

export interface OrderPlacedBody {
    to: string;
    orderId: string;
    total: string;
    prepTimeMinutes: number | string;
    qrImageUrl?: string | null;
}

export interface OrderReadyBody {
    to: string;
    orderId: string;
    vendorName: string;
}

// Schemas
export const sendWhatsAppMessageSchema: FastifySchema = {
    description: "Send a WhatsApp test message",
    tags: ["whatsapp"],
    body: {
        type: "object",
        properties: {
            to: { type: "string", description: "Recipient phone number in international format e.g. +27721234567" },
            message: { type: "string", description: "Message body to send" }
        },
        required: ["to", "message"]
    },
    response: {
        201: successResponse,
        400: errorResponse,
        500: errorResponse
    }
};

export const orderPlacedSchema: FastifySchema = {
    description: "Send order confirmation template (order_placed)",
    tags: ["whatsapp"],
    body: {
        type: "object",
        properties: {
            to: { type: "string", description: "Recipient phone, e.g. +27721234567" },
            orderId: { type: "string" },
            total: { type: "string", description: "e.g. $12.50 or 12.50 USD" },
            prepTimeMinutes: { type: ["number", "string"] },
            qrImageUrl: { type: "string", nullable: true }
        },
        required: ["to", "orderId", "total", "prepTimeMinutes"]
    },
    response: {
        201: successResponse,
        400: errorResponse,
        500: errorResponse
    }
};

export const orderReadySchema: FastifySchema = {
    description: "Send order ready notification template",
    tags: ["whatsapp"],
    body: {
        type: "object",
        properties: {
            to: { type: "string", description: "Recipient phone, e.g. +27721234567" },
            orderId: { type: "string" },
            vendorName: { type: "string" }
        },
        required: ["to", "orderId", "vendorName"]
    },
    response: {
        201: successResponse,
        400: errorResponse,
        500: errorResponse
    }
};
