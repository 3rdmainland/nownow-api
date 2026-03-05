// Branding schema
const brandingSchema = {
    type: "object",
    properties: {
        theme: {
            type: "object",
            properties: {
                primary: { type: "string" },
                secondary: { type: "string" },
                accent: { type: "string" },
                background: { type: "string" },
                foreground: { type: "string" },
                landingBackground: { type: "string" },
                landingTextColor: { type: "string", enum: ["light", "dark"] },
            },
            additionalProperties: false,
        },
        assets: {
            type: "object",
            properties: {
                logoLight: { type: "string" },
                logoDark: { type: "string" },
                favicon: { type: "string" },
                backgroundImage: { type: "string" },
                appBackgroundImage: { type: "string" },
            },
            additionalProperties: false,
        },
        copy: {
            type: "object",
            properties: {
                tagline: { type: "string" },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: false,
};

// Location schema
const locationSchema = {
    type: "object",
    properties: {
        latitude: { type: "number" },
        longitude: { type: "number" },
        address: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        zipCode: { type: "string" }
    },
    required: ["latitude", "longitude", "address", "city", "state", "zipCode"]
};

// Event schema
const eventSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        startDate: { type: "string", format: "date-time" },
        endDate: { type: "string", format: "date-time" },
        location: locationSchema,
        imageUrl: { type: "string" },
        isPublic: { type: "boolean" },
        status: {
            type: "string",
            enum: ["ACTIVE", "CANCELED"]
        },
        created_at: { type: "string" },
        updated_at: { type: "string" },
        vendorIds: { type: "array", items: { type: "string" } },
        code: { type: "string" },
        branding: brandingSchema,
    },
    required: [
        "id",
        "name",
        "startDate",
        "endDate",
        "location",
        "isPublic",
        "status",
        "created_at",
        "vendorIds",
        "code"
    ]
};

// ---------------- API Schemas ----------------

// GET all events
export const getEventsResponseSchema = {
    description: "Get all events",
    tags: ['events'],
    response: {
        200: {
            type: "object",
            properties: { events: { type: "array", items: eventSchema } },
            required: ["events"]
        },
        500: { type: "object", properties: { error: { type: "string" } }, required: ["error"] }
    }
};

// GET event by code
export const getEventByCodeResponseSchema = {
    description: "Get event by code",
    tags: ['events'],
    params: {
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"]
    },
    response: {
        200: {
            type: "object",
            properties: { event: eventSchema },
            required: ["event"]
        },
        404: { type: "object", properties: { error: { type: "string" } }, required: ["error"] },
        500: { type: "object", properties: { error: { type: "string" } }, required: ["error"] }
    }
};

// GET event by ID
export const getEventByIdResponseSchema = {
    description: "Get event by ID",
    tags: ['events'],
    response: {
        200: {
            type: "object",
            properties: { event: eventSchema },
            required: ["event"]
        },
        404: { type: "object", properties: { error: { type: "string" } }, required: ["error"] },
        500: { type: "object", properties: { error: { type: "string" } }, required: ["error"] }
    }
};

// CREATE event
export const createEventSchema = {
    description: "Create a new event",
    tags: ['events'],
    body: {
        type: "object",
        properties: {
            name: { type: "string" },
            description: { type: "string" },
            startDate: { type: "string", format: "date-time" },
            endDate: { type: "string", format: "date-time" },
            location: locationSchema,
            imageUrl: { type: "string" },
            isPublic: { type: "boolean" },
            vendorIds: { type: "array", items: { type: "string" } },
            code: { type: "string" },
            branding: brandingSchema,
        },
        required: ["name", "startDate", "endDate", "location", "isPublic", "vendorIds", "code"]
    },
    response: {
        201: {
            type: "object",
            properties: { event: eventSchema },
            required: ["event"]
        },
        500: { type: "object", properties: { error: { type: "string" } } }
    }
};

// UPDATE event
export const updateEventSchema = {
    description: "Update an existing event",
    tags: ['events'],
    params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
    },
    body: {
        type: "object",
        properties: {
            name: { type: "string" },
            description: { type: "string" },
            startDate: { type: "string", format: "date-time" },
            endDate: { type: "string", format: "date-time" },
            location: locationSchema,
            imageUrl: { type: "string" },
            isPublic: { type: "boolean" },
            status: { type: "string", enum: ["ACTIVE", "CANCELED"] },
            vendorIds: { type: "array", items: { type: "string" } },
            code: { type: "string" },
            branding: brandingSchema,
        }
    },
    response: {
        200: {
            type: "object",
            properties: { event: eventSchema },
            required: ["event"]
        },
        500: { type: "object", properties: { error: { type: "string" } } }
    }
};

// DELETE event
export const deleteEventSchema = {
    description: "Delete an event",
    tags: ['events'],
    params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
    },
    response: {
        204: { type: "null" },
        500: { type: "object", properties: { error: { type: "string" } } }
    }
};

// ADD vendors to event
export const addVendorsToEventSchema = {
    description: "Add vendors to an event",
    tags: ['events'],
    params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
    },
    body: {
        type: "object",
        properties: {
            vendorIds: { type: "array", items: { type: "string" } }
        },
        required: ["vendorIds"]
    },
    response: {
        204: { type: "null" },
        500: { type: "object", properties: { error: { type: "string" } } }
    }
};

// REMOVE vendor from event
export const removeVendorFromEventSchema = {
    description: "Remove a vendor from an event",
    tags: ['events'],
    params: {
        type: "object",
        properties: { id: { type: "string" }, vendorId: { type: "string" } },
        required: ["id", "vendorId"]
    },
    response: {
        204: { type: "null" },
        500: { type: "object", properties: { error: { type: "string" } } }
    }
};

// GET events by vendor ID
export const getEventsByVendorSchema = {
    description: "Get all events for a particular vendor",
    tags: ['events'],
    params: {
        type: "object",
        properties: { vendorId: { type: "string" } },
        required: ["vendorId"]
    },
    querystring: {
        type: "object",
        properties: {
            active: { type: "string", enum: ["true", "false"] }
        },
        additionalProperties: false
    },
    response: {
        200: {
            type: "object",
            properties: { events: { type: "array", items: eventSchema } },
            required: ["events"]
        },
        500: { type: "object", properties: { error: { type: "string" } }, required: ["error"] }
    }
};
