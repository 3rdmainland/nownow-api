const uploadResponse = {
    200: {
        type: "object",
        properties: {
            url: { type: "string" },
            purpose: { type: "string" },
            fileName: { type: "string" },
        },
        required: ["url", "purpose", "fileName"],
    },
    400: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
    },
    500: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
    },
};

export const uploadEventImageSchema = {
    description: "Upload an event image (branding or banner)",
    tags: ['upload'],
    params: {
        type: "object",
        properties: {
            eventId: { type: "string" },
        },
        required: ["eventId"],
    },
    querystring: {
        type: "object",
        properties: {
            purpose: { type: "string", enum: ["landing-bg", "app-bg", "event-banner", "logo-light", "logo-dark", "favicon"] },
        },
        required: ["purpose"],
    },
    response: uploadResponse,
};

export const uploadVendorImageSchema = {
    description: "Upload a vendor image (logo)",
    tags: ['upload'],
    params: {
        type: "object",
        properties: {
            vendorId: { type: "string" },
        },
        required: ["vendorId"],
    },
    querystring: {
        type: "object",
        properties: {
            purpose: { type: "string", enum: ["vendor-logo"] },
        },
        required: ["purpose"],
    },
    response: uploadResponse,
};

export const uploadMenuItemImageSchema = {
    description: "Upload a menu item image",
    tags: ['upload'],
    params: {
        type: "object",
        properties: {
            vendorId: { type: "string" },
        },
        required: ["vendorId"],
    },
    querystring: {
        type: "object",
        properties: {
            purpose: { type: "string", enum: ["menu-item"] },
        },
        required: ["purpose"],
    },
    response: uploadResponse,
};
