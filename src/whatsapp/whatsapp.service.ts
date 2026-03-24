import { WhatsAppLogger } from './whatsapp.logger.js';

interface WhatsAppApiError {
    error?: {
        message?: string;
    };
}

interface WhatsAppApiSuccess {
    messages?: Array<{ id: string }>;
}

export class WhatsappService {
    private apiUrl: string;
    private token: string;
    private logger: WhatsAppLogger;

    constructor() {
        this.apiUrl = `https://graph.facebook.com/${process.env.WA_API_VERSION}/${process.env.WA_PHONE_NUMBER_ID}/messages`;
        this.token = process.env.WA_ACCESS_TOKEN as string;
        this.logger = new WhatsAppLogger();

        if (!this.token) {
            throw new Error("Missing WA_ACCESS_TOKEN in environment variables");
        }
    }

    /**
     * Extract wa_message_id from Meta API response and log the message.
     */
    private logSend(
        data: any,
        phone: string,
        templateName: string,
        category: 'utility' | 'marketing',
        nudgeId?: string,
    ): void {
        const waMessageId = (data as WhatsAppApiSuccess)?.messages?.[0]?.id;
        void this.logger
            .logMessage({ waMessageId, phone, templateName, category, nudgeId })
            .catch((err) => console.error('WhatsApp log failed:', (err as Error).message));
    }

    /**
     * Send a WhatsApp text message via Meta Cloud API
     */
    async sendWhatsAppMessage(to: string): Promise<void> {
        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                "name": "hello_world",
                "language": { "code": "en_US" }
            }
        }


        const res = await fetch(this.apiUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json() as WhatsAppApiError;

        if (!res.ok) {
            console.error("WhatsApp API error:", data);
            throw new Error(`WhatsApp API error: ${data?.error?.message || "Unknown error"}`);
        }

        console.log("WhatsApp message sent:", data);
    }

    /**
     * Send a WhatsApp template message: order_places
     * Body placeholders order:
     * 1) orderId
     * 2) total
     * 3) prepTimeMinutes
     * Optional header image can be sent if your template has a header configured.
     */
    async sendOrderPlacedTemplate(
        to: string,
        params: { orderId: string; total: string; prepTimeMinutes: number | string; qrImageUrl?: string }
    ): Promise<void> {
        const { orderId, total, prepTimeMinutes, qrImageUrl } = params;

        const components: any[] = [
            {
                type: "header",
                parameters: [
                    {
                        type: "image",
                        image: {
                            link: qrImageUrl ?? "https://plahold.co/400x400.png"
                        }
                    }
                ]
            },
            {
                type: "body",
                parameters: [
                    { type: "text", text: String(orderId) },
                    { type: "text", text: String(total) },
                    { type: "text", text: String(prepTimeMinutes) }
                ]
            }
        ];

        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: "place_order",
                language: { code: "en" },
                components
            }
        };

        console.log("Sending place_order template to WhatsApp:", JSON.stringify(payload));

        const res = await fetch(this.apiUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json() as WhatsAppApiError;
        if (!res.ok) {
            console.error("WhatsApp API error:", data);
            throw new Error(`WhatsApp API error: ${data?.error?.message || "Unknown error"}`);
        }

        console.log("WhatsApp place_order template sent:", data);
        this.logSend(data, to, 'place_order', 'utility');
    }


    /**
     * Send a WhatsApp template message: order_ready_notification
     * Body placeholders order:
     * 1) order_id
     * 2) vendor_name
     * Optional header image (QR code) if your template has a header configured.
     */
    async sendOrderReadyTemplate(
        to: string,
        params: { orderId: string; vendorName: string }
    ): Promise<void> {
        const { orderId, vendorName } = params;

        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: "order_ready_notification",
                language: { code: "en" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: String(orderId) },
                            { type: "text", text: String(vendorName) }
                        ]
                    }
                ]
            }
        };

        console.log('Sending order_ready template:', JSON.stringify(payload, null, 2));

        const res = await fetch(this.apiUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json() as WhatsAppApiError;
        console.log('Full API response:', JSON.stringify(data, null, 2));

        if (!res.ok) {
            console.error("WhatsApp API error:", data);
            throw new Error(`WhatsApp API error: ${data?.error?.message || "Unknown error"}`);
        }

        console.log("WhatsApp order_ready_notification sent:", data);
        this.logSend(data, to, 'order_ready_notification', 'utility');
    }

    /**
     * Send a WhatsApp template message: order_collected_confirmation
     * Body placeholders:
     * 1) order_id
     * 2) vendor_name
     */
// Update sendOrderCollectedTemplate in whatsapp.service.ts

    async sendOrderCollectedTemplate(
        to: string,
        params: { orderId: string; vendorName: string }
    ): Promise<void> {
        const { orderId, vendorName } = params;

        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: "order_collected_confirmation",
                language: { code: "en" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            {
                                type: "text",
                                parameter_name: "order_id",
                                text: String(orderId)
                            },
                            {
                                type: "text",
                                parameter_name: "vendor_name",
                                text: String(vendorName)
                            }
                        ]
                    }
                ]
            }
        };

        console.log('Sending order_collected_confirmation template:', JSON.stringify(payload, null, 2));

        const res = await fetch(this.apiUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json() as WhatsAppApiError;

        if (!res.ok) {
            console.error("WhatsApp API error:", data);
            throw new Error(`WhatsApp API error: ${data?.error?.message || "Unknown error"}`);
        }

        console.log("WhatsApp order_collected_confirmation sent:", data);
        this.logSend(data, to, 'order_collected_confirmation', 'utility');
    }

    // ── Retention templates ─────────────────────────────────────────────

    /**
     * In-event upsell suggestion (marketing template).
     */
    async sendUpsellTemplate(
        to: string,
        params: { eventName: string; itemName: string; itemPrice: string; quickLinkUrl: string },
        nudgeId?: string,
    ): Promise<void> {
        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: "event_upsell",
                language: { code: "en" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: params.eventName },
                            { type: "text", text: params.itemName },
                            { type: "text", text: params.itemPrice },
                        ],
                    },
                    {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [{ type: "text", text: params.quickLinkUrl }],
                    },
                ],
            },
        };

        const res = await fetch(this.apiUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await res.json() as WhatsAppApiError;
        if (!res.ok) {
            console.error("WhatsApp upsell error:", data);
            throw new Error(`WhatsApp API error: ${data?.error?.message || "Unknown error"}`);
        }

        console.log("WhatsApp event_upsell sent:", data);
        this.logSend(data, to, 'event_upsell', 'marketing', nudgeId);
    }

    /**
     * Post-event order summary (utility template).
     */
    async sendPostEventSummaryTemplate(
        to: string,
        params: { eventName: string; orderCount: string; totalSpent: string },
        nudgeId?: string,
    ): Promise<void> {
        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: "post_event_summary",
                language: { code: "en" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: params.eventName },
                            { type: "text", text: params.orderCount },
                            { type: "text", text: params.totalSpent },
                        ],
                    },
                ],
            },
        };

        const res = await fetch(this.apiUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await res.json() as WhatsAppApiError;
        if (!res.ok) {
            console.error("WhatsApp post-event summary error:", data);
            throw new Error(`WhatsApp API error: ${data?.error?.message || "Unknown error"}`);
        }

        console.log("WhatsApp post_event_summary sent:", data);
        this.logSend(data, to, 'post_event_summary', 'utility', nudgeId);
    }

    /**
     * Reorder suggestion with deep link (marketing template).
     */
    async sendReorderSuggestionTemplate(
        to: string,
        params: { eventName: string; itemNames: string; reorderUrl: string },
        nudgeId?: string,
    ): Promise<void> {
        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: "reorder_suggestion",
                language: { code: "en" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: params.eventName },
                            { type: "text", text: params.itemNames },
                        ],
                    },
                    {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [{ type: "text", text: params.reorderUrl }],
                    },
                ],
            },
        };

        const res = await fetch(this.apiUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await res.json() as WhatsAppApiError;
        if (!res.ok) {
            console.error("WhatsApp reorder suggestion error:", data);
            throw new Error(`WhatsApp API error: ${data?.error?.message || "Unknown error"}`);
        }

        console.log("WhatsApp reorder_suggestion sent:", data);
        this.logSend(data, to, 'reorder_suggestion', 'marketing', nudgeId);
    }

    /**
     * Cross-event retention: favourite vendors at a new event (marketing template).
     */
    async sendEventNearbyTemplate(
        to: string,
        params: { eventName: string; vendorNames: string; eventUrl: string },
        nudgeId?: string,
    ): Promise<void> {
        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: "event_nearby",
                language: { code: "en" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: params.eventName },
                            { type: "text", text: params.vendorNames },
                        ],
                    },
                    {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [{ type: "text", text: params.eventUrl }],
                    },
                ],
            },
        };

        const res = await fetch(this.apiUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await res.json() as WhatsAppApiError;
        if (!res.ok) {
            console.error("WhatsApp event_nearby error:", data);
            throw new Error(`WhatsApp API error: ${data?.error?.message || "Unknown error"}`);
        }

        console.log("WhatsApp event_nearby sent:", data);
        this.logSend(data, to, 'event_nearby', 'marketing', nudgeId);
    }
}
