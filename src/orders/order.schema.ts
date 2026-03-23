// OrderItem schema
const orderItemSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        name: { type: "string" },
        price: { type: "number" },
        imageUrl: { type: "string" },
        prepTime: { type: "number" },
        quantity: { type: "number" },
        vendorId: { type: "string" },
        vendorName: { type: "string" },
        selectedModifiers: {
            type: "object",
            description: "Map of modifier group IDs to arrays of selected modifier IDs",
            additionalProperties: {
                type: "array",
                items: { type: "string" }
            }
        },
        modifierSummary: {
            type: "string",
            description: "Human-readable summary of selected modifiers (e.g., 'Family Size, Extra Cheese')"
        }
    },
    required: ["id", "name", "price", "quantity"]
};

// Order schema
const orderSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        vendor_id: { type: "string" },
        event_id: { type: "string" },
        phone: { type: "string" },
        items: { type: "array", items: orderItemSchema },
        total: { type: "number" },
        status: {
            type: "string",
            enum: ["PENDING", "PREPARING", "READY", "COLLECTED", "CANCELLED"]
        },
        type: {
            type: "string",
            enum: ["CART", "ORDER", "CANCELLED"]
        },
        notes: { type: "string" },
        estimatedPrepTime: { type: "number" },
        paymentMethod: { type: "string" },
        payment_method: { type: "string" },
        payment_status: { type: "string" },
        service_fee: { type: "number" },
        qr_code: { type: "string" },
        qr_image: { type: "string" },
        created_at: { type: "string" },
        collected_at: { type: "string" },
        prepared_at: { type: "string" },
        ready_at: { type: "string" },
        scheduled_pickup_time: { type: "string" },
        actual_prep_time: { type: "number" },
        queue_position: { type: "number" },
        estimated_ready_time: { type: "string" },
        vendor: {
            type: "object",
            properties: { name: { type: "string" } }
        },
        stall_info: { type: ["string", "null"] },
        refund_status: { type: "string", enum: ["none", "full", "partial"] },
        refund_amount: { type: ["number", "null"] },
        refund_reason: { type: ["string", "null"] },
        refunded_at: { type: ["string", "null"] },
        refunded_by: { type: ["string", "null"] },
        age_verified: { type: "boolean" },
        age_verified_at: { type: "string" },
        customer_id: { type: "string" }
    },
    required: [
        "id",
        "vendor_id",
        "phone",
        "items",
        "total",
        "status",
        "type",
        "qr_code",
        "created_at"
    ]
};

// ---------------- Pagination Fragments ----------------

const paginationQuerystringProperties = {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }
};

const paginationResponseProperties = {
    page: { type: "integer" },
    pageSize: { type: "integer" },
    total: { type: "integer" },
    totalPages: { type: "integer" }
};

// ---------------- API Schemas ----------------

// GET all orders
export const getOrdersResponseSchema = {
    description: "Get all orders",
    tags: ['orders'],
    querystring: {
        type: "object",
        properties: {
            vendorId: { type: "string" },
            eventId: { type: "string" },
            status: { type: "string" },
            startDate: { type: "string", format: "date-time" },
            endDate: { type: "string", format: "date-time" },
            ...paginationQuerystringProperties
        }
    },
    response: {
        200: {
            type: "object",
            properties: {
                orders: { type: "array", items: orderSchema },
                ...paginationResponseProperties
            },
            required: ["orders", "page", "pageSize", "total", "totalPages"]
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } },
            required: ["error"]
        }
    }
};

// GET order by ID
export const getOrderByIdResponseSchema = {
    description: "Get order by ID",
    tags: ['orders'],
    response: {
        200: {
            type: "object",
            properties: { order: orderSchema },
            required: ["order"]
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } },
            required: ["error"]
        }
    }
};

// CREATE order
export const createOrderSchema = {
    description: "Create a new order with optional scheduled pickup time",
    tags: ['orders'],
    body: {
        type: "object",
        properties: {
            vendor_id: { type: "string" },
            event_id: { type: "string" },
            phone: { type: "string" },
            items: { type: "array", items: orderItemSchema },
            total: { type: "number" },
            notes: { type: "string" },
            paymentMethod: { type: "string" },
            scheduled_pickup_time: {
                type: "string",
                format: "date-time",
                description: "Optional: ISO 8601 datetime for future order pickup. If omitted, order is immediate."
            },
            age_verified: { type: "boolean" }
        },
        required: ["vendor_id", "event_id", "phone", "items", "total"]
    },
    response: {
        201: {
            type: "object",
            properties: {
                order: orderSchema,
                paymentUrl: { type: ["string", "null"] }
            },
            required: ["order"]
        },
        400: {
            type: "object",
            properties: { error: { type: "string" } }
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};

// UPDATE order status
export const updateOrderStatusSchema = {
    description: "Update order status",
    tags: ['orders'],
    params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
    },
    body: {
        type: "object",
        properties: {
            status: {
                type: "string",
                enum: ["PENDING", "PREPARING", "READY", "COLLECTED", "CANCELLED"]
            }
        },
        required: ["status"]
    },
    response: {
        200: {
            type: "object",
            properties: { order: orderSchema },
            required: ["order"]
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};

// GET orders by vendor
export const getOrdersByVendorSchema = {
    description: "Get orders by vendor",
    tags: ['orders'],
    params: {
        type: "object",
        properties: { vendorId: { type: "string" } },
        required: ["vendorId"]
    },
    querystring: {
        type: "object",
        properties: { ...paginationQuerystringProperties }
    },
    response: {
        200: {
            type: "object",
            properties: {
                orders: { type: "array", items: orderSchema },
                ...paginationResponseProperties
            },
            required: ["orders", "page", "pageSize", "total", "totalPages"]
        },
        401: {
            type: "object",
            properties: { error: { type: "string" } }
        },
        403: {
            type: "object",
            properties: { error: { type: "string" } }
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};

// GET orders by phone
export const getOrdersByPhoneSchema = {
    description: "Get orders by phone",
    tags: ['orders'],
    querystring: {
        type: "object",
        properties: {
            phone: { type: "string" },
            eventId: { type: "string" },
            ...paginationQuerystringProperties
        },
        required: ["phone"]
    },
    response: {
        200: {
            type: "object",
            properties: {
                orders: { type: "array", items: orderSchema },
                ...paginationResponseProperties
            },
            required: ["orders", "page", "pageSize", "total", "totalPages"]
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};

// GET orders by status
export const getOrdersByStatusSchema = {
    description: "Get orders by status",
    tags: ['orders'],
    querystring: {
        type: "object",
        properties: {
            status: {
                type: "string",
                enum: ["PENDING", "PREPARING", "READY", "COLLECTED", "CANCELLED"]
            },
            ...paginationQuerystringProperties
        },
        required: ["status"]
    },
    response: {
        200: {
            type: "object",
            properties: {
                orders: { type: "array", items: orderSchema },
                ...paginationResponseProperties
            },
            required: ["orders", "page", "pageSize", "total", "totalPages"]
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};

// GET recent orders
export const getRecentOrdersSchema = {
    description: "Get recent orders",
    tags: ['orders'],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 10 }
        }
    },
    response: {
        200: {
            type: "object",
            properties: { orders: { type: "array", items: orderSchema } },
            required: ["orders"]
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};

// DELETE order
export const deleteOrderSchema = {
    description: "Delete order",
    tags: ['orders'],
    params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
    },
    response: {
        204: { type: "null" },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};

// GET orders by date range
export const getOrdersByDateRangeSchema = {
    description: "Get orders by date range",
    tags: ['orders'],
    querystring: {
        type: "object",
        properties: {
            startDate: { type: "string", format: "date-time" },
            endDate: { type: "string", format: "date-time" },
            ...paginationQuerystringProperties
        },
        required: ["startDate", "endDate"]
    },
    response: {
        200: {
            type: "object",
            properties: {
                orders: { type: "array", items: orderSchema },
                ...paginationResponseProperties
            },
            required: ["orders", "page", "pageSize", "total", "totalPages"]
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};

// GET order stats
export const getOrderStatsSchema = {
    description: "Get order stats",
    tags: ['orders'],
    querystring: {
        type: "object",
        properties: { vendorId: { type: "string" }, eventId: { type: "string" } },
    },
    response: {
        200: {
            type: "object",
            properties: {
                totalOrders: { type: "number" },
                totalRevenue: { type: "number" },
                averageOrderValue: { type: "number" },
                ordersByStatus: {
                    type: "object",
                    additionalProperties: { type: "number" }
                },
                grossSales: { type: "number" },
                collectedRevenue: { type: "number" },
                cancelledCount: { type: "number" },
                cancelledValue: { type: "number" },
                topItem: {
                    type: ["object", "null"],
                    properties: {
                        name: { type: "string" },
                        qty: { type: "number" }
                    }
                },
                paymentBreakdown: {
                    type: "object",
                    additionalProperties: { type: "number" }
                },
                topItems: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            qty: { type: "number" }
                        },
                        required: ["name", "qty"]
                    }
                },
                refundedCount: { type: "number" },
                refundedValue: { type: "number" },
                avgTurnaroundMinutes: { type: ["number", "null"] },
                peakHours: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            hour: { type: "number" },
                            count: { type: "number" }
                        },
                        required: ["hour", "count"]
                    }
                },
                avgItemsPerOrder: { type: ["number", "null"] },
                repeatCustomerCount: { type: "number" }
            },
            required: [
                "totalOrders", "totalRevenue", "averageOrderValue", "ordersByStatus",
                "grossSales", "collectedRevenue", "cancelledCount", "cancelledValue",
                "topItem", "paymentBreakdown", "topItems", "refundedCount", "refundedValue",
                "avgTurnaroundMinutes", "peakHours", "avgItemsPerOrder", "repeatCustomerCount"
            ]
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};

// GET time-series stats
export const getTimeSeriesStatsSchema = {
    description: "Get time-series order stats with bucketed data",
    tags: ['orders'],
    querystring: {
        type: "object",
        properties: {
            vendorId: { type: "string" },
            eventId: { type: "string" },
            startDate: { type: "string", format: "date-time" },
            endDate: { type: "string", format: "date-time" },
            granularity: { type: "string", enum: ["day", "week", "month"], default: "day" }
        },
        required: ["startDate", "endDate"]
    },
    response: {
        200: {
            type: "object",
            properties: {
                buckets: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            date: { type: "string" },
                            revenue: { type: "number" },
                            orderCount: { type: "number" },
                            collectedRevenue: { type: "number" },
                            cancelledCount: { type: "number" },
                            refundedCount: { type: "number" }
                        },
                        required: ["date", "revenue", "orderCount", "collectedRevenue", "cancelledCount", "refundedCount"]
                    }
                },
                summary: {
                    type: "object",
                    properties: {
                        grossSales: { type: "number" },
                        collectedRevenue: { type: "number" },
                        totalOrders: { type: "number" },
                        averageOrderValue: { type: "number" },
                        cancelledCount: { type: "number" },
                        cancelledValue: { type: "number" },
                        paymentBreakdown: { type: "object", additionalProperties: { type: "number" } },
                        ordersByStatus: { type: "object", additionalProperties: { type: "number" } },
                        topItems: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: { name: { type: "string" }, qty: { type: "number" } },
                                required: ["name", "qty"]
                            }
                        },
                        refundedCount: { type: "number" },
                        refundedValue: { type: "number" }
                    },
                    required: ["grossSales", "collectedRevenue", "totalOrders", "averageOrderValue", "cancelledCount", "cancelledValue", "paymentBreakdown", "ordersByStatus", "topItems", "refundedCount", "refundedValue"]
                },
                previousPeriod: {
                    type: "object",
                    properties: {
                        grossSales: { type: "number" },
                        collectedRevenue: { type: "number" },
                        totalOrders: { type: "number" },
                        averageOrderValue: { type: "number" }
                    },
                    required: ["grossSales", "collectedRevenue", "totalOrders", "averageOrderValue"]
                }
            },
            required: ["buckets", "summary", "previousPeriod"]
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } },
            required: ["error"]
        }
    }
};

// SEARCH orders
export const searchOrdersSchema = {
    description: "Search orders (optionally filter by event)",
    tags: ['orders'],
    querystring: {
        type: "object",
        properties: {
            q: { type: "string", minLength: 1 },
            eventId: { type: "string", description: "If provided, limits search to this event's orders" },
            ...paginationQuerystringProperties
        },
        required: ["q"]
    },
    response: {
        200: {
            type: "object",
            properties: {
                orders: { type: "array", items: orderSchema },
                ...paginationResponseProperties
            },
            required: ["orders", "page", "pageSize", "total", "totalPages"]
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};


// GET orders by event
export const getOrdersByEventSchema = {
    description: "Get orders by event",
    tags: ['orders'],
    params: {
        type: "object",
        properties: { eventId: { type: "string" } },
        required: ["eventId"]
    },
    querystring: {
        type: "object",
        properties: { ...paginationQuerystringProperties }
    },
    response: {
        200: {
            type: "object",
            properties: {
                orders: { type: "array", items: orderSchema },
                ...paginationResponseProperties
            },
            required: ["orders", "page", "pageSize", "total", "totalPages"]
        },
        401: {
            type: "object",
            properties: { error: { type: "string" } }
        },
        403: {
            type: "object",
            properties: { error: { type: "string" } }
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};

export const confirmCollectionSchema = {
    description: "Confirm collection of order. This will update the order status to COLLECTED only when status is READY and set the collected_at timestamp.",
    tags: ['orders'],
    body: {
        type: 'object',
        properties: {
            qr_code: { type: 'string' },
            vendor_id: { type: 'string' }
        },
        required: ['qr_code']
    },
    response: {
        200: {
            type: 'object',
            properties: {
                order: { /* same as getOrderByIdResponseSchema */ }
            }
        },
        400: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

// GET available time slots
export const getAvailableTimeSlotsSchema = {
    description: "Get available time slots for scheduling orders with a vendor during an event",
    tags: ['orders'],
    querystring: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
            slotDurationMinutes: {
                type: 'integer',
                minimum: 15,
                maximum: 120,
                default: 30,
                description: "Duration of each time slot in minutes"
            }
        },
        required: ['vendorId', 'eventId']
    },
    response: {
        200: {
            type: 'object',
            properties: {
                slots: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            startTime: { type: 'string', format: 'date-time' },
                            endTime: { type: 'string', format: 'date-time' },
                            available: { type: 'boolean' },
                            queueLength: { type: 'number' }
                        }
                    }
                }
            }
        },
        500: {
            type: 'object',
            properties: { error: { type: 'string' } }
        }
    }
};

// VALIDATE scheduled pickup time
export const validateScheduledPickupSchema = {
    description: "Validate if a scheduled pickup time is feasible before placing an order",
    tags: ['orders'],
    querystring: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
            scheduledPickupTime: { type: 'string', format: 'date-time' }
        },
        required: ['vendorId', 'eventId', 'scheduledPickupTime']
    },
    response: {
        200: {
            type: 'object',
            properties: {
                isValid: { type: 'boolean' },
                error: { type: 'string' },
                estimatedReadyTime: { type: 'string', format: 'date-time' },
                queuePosition: { type: 'number' }
            },
            required: ['isValid']
        },
        500: {
            type: 'object',
            properties: { error: { type: 'string' } }
        }
    }
};

// GET checkout options
export const checkoutOptionsSchema = {
    description: "Get checkout options for a vendor at an event (e.g. pay-at-stall availability)",
    tags: ['orders'],
    querystring: {
        type: 'object',
        properties: {
            vendorId: { type: 'string' },
            eventId: { type: 'string' },
        },
        required: ['vendorId', 'eventId']
    },
    response: {
        200: {
            type: 'object',
            properties: {
                allowPayAtStall: { type: 'boolean' }
            },
            required: ['allowPayAtStall']
        },
        500: {
            type: 'object',
            properties: { error: { type: 'string' } }
        }
    }
};

// GET orders by customer (authenticated)
export const getOrdersByCustomerSchema = {
    description: "Get orders for the authenticated customer",
    tags: ['orders'],
    querystring: {
        type: "object",
        properties: {
            eventId: { type: "string" },
            ...paginationQuerystringProperties
        }
    },
    response: {
        200: {
            type: "object",
            properties: {
                orders: { type: "array", items: orderSchema },
                ...paginationResponseProperties
            },
            required: ["orders", "page", "pageSize", "total", "totalPages"]
        },
        401: {
            type: "object",
            properties: { error: { type: "string" } }
        },
        500: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};

// REFUND order
export const refundOrderSchema = {
    description: "Refund an order (full or partial). Track-only — no payment reversal.",
    tags: ['orders'],
    params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
    },
    body: {
        type: "object",
        properties: {
            type: { type: "string", enum: ["full", "partial"] },
            amount: { type: "number", minimum: 0.01 },
            reason: { type: "string", minLength: 1 }
        },
        required: ["type", "reason"]
    },
    response: {
        200: {
            type: "object",
            properties: { order: orderSchema },
            required: ["order"]
        },
        400: {
            type: "object",
            properties: { error: { type: "string" } }
        },
        404: {
            type: "object",
            properties: { error: { type: "string" } }
        }
    }
};
