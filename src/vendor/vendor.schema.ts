// Updated vendor properties to match database schema
const vendorProperties = {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    phone: { type: 'string' },
    email: { type: 'string', format: 'email' },
    imageUrl: { type: 'string' },
    logoUrl: { type: 'string' },
    categoryId: { type: 'string' }, // DEPRECATED: first category for backwards compat
    categoryIds: { type: 'array', items: { type: 'string' } },
    categories: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                name: { type: 'string' }
            }
        }
    },
    cuisineType: { type: 'array', items: { type: 'string' } },
    rating: { type: 'number' },
    totalReviews: { type: 'number' },
    location: {
        type: 'object',
        // Flexible structure - can be full address, stall number, or anything
        additionalProperties: true
    },
    hours: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                dayOfWeek: { type: 'number', minimum: 0, maximum: 6 },
                openTime: { type: 'string' },
                closeTime: { type: 'string' },
                isClosed: { type: 'boolean' }
            },
            required: ['dayOfWeek', 'openTime', 'closeTime', 'isClosed']
        }
    },
    isActive: { type: 'boolean' },
    isPaused: { type: 'boolean' },
    minimumOrder: { type: 'number' },
    deliveryFee: { type: 'number' },
    estimatedPrepTime: { type: 'number' },
    paymentMethods: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
};

// Menu preview item properties (used in getVendorsByEvent response)
const menuPreviewProperties = {
    id: { type: 'string' },
    vendorId: { type: 'string' },
    categoryId: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    price: { type: 'number' },
    imageUrl: { type: 'string' },
    type: { type: 'string', enum: ['FOOD', 'RETAIL'] },
    prepTime: { type: 'number' },
    available: { type: 'boolean' },
    isAlcohol: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
};

export const getVendorsSchema = {
    description: 'Get all active vendors',
    tags: ['vendors'],
    querystring: {
        type: 'object',
        properties: {
            excludeEventId: { type: 'string', description: 'Exclude vendors already assigned to this event' }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                vendors: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: vendorProperties
                    }
                }
            }
        },
        500: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

export const getVendorByIdSchema = {
    description: 'Get vendor by ID',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string' }
        },
        required: ['id']
    },
    response: {
        200: {
            type: 'object',
            properties: {
                vendor: {
                    type: 'object',
                    properties: vendorProperties
                }
            }
        },
        404: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        },
        500: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

export const createVendorSchema = {
    description: 'Create new vendor',
    tags: ['vendors'],
    body: {
        type: 'object',
        required: ['name', 'phone', 'email', 'categoryIds', 'paymentMethods'], // location and hours are optional
        properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string', format: 'email' },
            imageUrl: { type: 'string' },
            logoUrl: { type: 'string' },
            categoryIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
            cuisineType: { type: 'array', items: { type: 'string' } },
            location: {
                type: 'object',
                additionalProperties: true // Flexible structure
            },
            hours: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['dayOfWeek', 'openTime', 'closeTime', 'isClosed'],
                    properties: {
                        dayOfWeek: { type: 'number', minimum: 0, maximum: 6 },
                        openTime: { type: 'string' },
                        closeTime: { type: 'string' },
                        isClosed: { type: 'boolean' }
                    }
                }
            },
            isActive: { type: 'boolean', default: true },
            isPaused: { type: 'boolean', default: false },
            minimumOrder: { type: 'number' },
            deliveryFee: { type: 'number' },
            estimatedPrepTime: { type: 'number' },
            paymentMethods: { type: 'array', items: { type: 'string' } }
        }
    },
    response: {
        201: {
            type: 'object',
            properties: {
                vendor: {
                    type: 'object',
                    properties: vendorProperties
                }
            }
        },
        500: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

export const updateVendorSchema = {
    description: 'Update vendor',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string' }
        },
        required: ['id']
    },
    body: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string', format: 'email' },
            imageUrl: { type: 'string' },
            logoUrl: { type: 'string' },
            categoryIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
            cuisineType: { type: 'array', items: { type: 'string' } },
            location: { type: 'object', additionalProperties: true },
            hours: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        dayOfWeek: { type: 'number', minimum: 0, maximum: 6 },
                        openTime: { type: 'string' },
                        closeTime: { type: 'string' },
                        isClosed: { type: 'boolean' }
                    }
                }
            },
            isActive: { type: 'boolean' },
            isPaused: { type: 'boolean' },
            minimumOrder: { type: 'number' },
            deliveryFee: { type: 'number' },
            estimatedPrepTime: { type: 'number' },
            paymentMethods: { type: 'array', items: { type: 'string' } }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                vendor: {
                    type: 'object',
                    properties: vendorProperties
                }
            }
        },
        500: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

export const deleteVendorSchema = {
    description: 'Delete vendor',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string' }
        },
        required: ['id']
    },
    response: {
        204: { type: 'null' },
        500: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

export const toggleVendorStatusSchema = {
    description: 'Toggle vendor active status',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string' }
        },
        required: ['id']
    },
    body: {
        type: 'object',
        required: ['isActive'],
        properties: {
            isActive: { type: 'boolean' }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                vendor: {
                    type: 'object',
                    properties: vendorProperties
                }
            }
        },
        500: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

export const pauseVendorSchema = {
    description: 'Pause/unpause vendor',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string' }
        },
        required: ['id']
    },
    body: {
        type: 'object',
        required: ['isPaused'],
        properties: {
            isPaused: { type: 'boolean' }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                vendor: {
                    type: 'object',
                    properties: vendorProperties
                }
            }
        },
        500: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

export const getVendorsByCategorySchema = {
    description: 'Get vendors by category ID',
    tags: ['vendors'],
    querystring: {
        type: 'object',
        required: ['categoryId'],
        properties: {
            categoryId: { type: 'string' }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                vendors: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: vendorProperties
                    }
                }
            }
        },
        500: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

export const getVendorsWithItemsInCategorySchema = {
    description: 'Get vendors that have at least one available menu item in the specified category',
    tags: ['vendors'],
    querystring: {
        type: 'object',
        required: ['categoryId'],
        properties: {
            categoryId: { type: 'string' },
            eventCode: { type: 'string' }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                vendors: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: vendorProperties
                    }
                }
            }
        },
        500: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

export const searchVendorsSchema = {
    description: 'Search vendors (optionally filter by event)',
    tags: ['vendors'],
    querystring: {
        type: 'object',
        required: ['q'],
        properties: {
            q: { type: 'string', minLength: 1 },
            eventId: { type: 'string', description: "If provided, limits search to this event's vendors" }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                vendors: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: vendorProperties
                    }
                }
            }
        },
        500: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

export const getEventMenuCategoriesSchema = {
    description: 'Get aggregated menu categories for an event',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: { eventId: { type: 'string' } },
        required: ['eventId']
    },
    response: {
        200: {
            type: 'object',
            properties: {
                categories: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            slug: { type: 'string' },
                            name: { type: 'string' },
                            vendorCount: { type: 'integer' },
                            imageUrl: { type: 'string' }
                        }
                    }
                }
            }
        },
        500: { type: 'object', properties: { error: { type: 'string' } } }
    }
};

export const getVendorsByEventSchema = {
    description: 'Get vendors assigned to an event (paginated)',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: { eventId: { type: 'string' } },
        required: ['eventId']
    },
    querystring: {
        type: 'object',
        properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            categoryId: { type: 'string' },
            menuCategorySlug: { type: 'string' }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                vendors: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            ...vendorProperties,
                            eventStatus: { type: 'string', enum: ['OPEN', 'CLOSED'] },
                            orderCount: { type: 'integer' },
                            menu: {
                                type: 'array',
                                items: { type: 'object', properties: menuPreviewProperties }
                            }
                        }
                    }
                },
                page: { type: 'integer' },
                pageSize: { type: 'integer' },
                total: { type: 'integer' },
                totalPages: { type: 'integer' }
            }
        },
        500: { type: 'object', properties: { error: { type: 'string' } } }
    }
};

export const getVendorStatsSchema = {
    description: 'Get vendor statistics',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string' }
        },
        required: ['id']
    },
    response: {
        200: {
            type: 'object',
            properties: {
                totalOrders: { type: 'number' },
                totalRevenue: { type: 'number' },
                averageRating: { type: 'number' },
                todayOrders: { type: 'number' },
                activeOrders: { type: 'number' }
            }
        },
        500: {
            type: 'object',
            properties: {
                error: { type: 'string' }
            }
        }
    }
};

