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

// Updated menu item properties
const menuItemProperties = {
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
    tags: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' }
            }
        }
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
};

export const getVendorsSchema = {
    description: 'Get all active vendors',
    tags: ['vendors'],
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
            categoryId: { type: 'string' }
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
                                items: { type: 'object', properties: menuItemProperties }
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

export const getVendorMenuSchema = {
    description: 'Get vendor menu items',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string' }
        },
        required: ['id']
    },
    querystring: {
        type: 'object',
        properties: {
            type: { type: 'string', enum: ['FOOD', 'RETAIL'] }, // Optional filter by type
            available: { type: 'boolean' } // Optional filter by availability
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                menuItems: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            category: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    name: { type: 'string' }
                                },
                                required: ['id', 'name']
                            },
                            menuItems: {
                                type: 'array',
                                items: { type: 'object', properties: menuItemProperties }
                            }
                        },
                        required: ['category', 'menuItems']
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

// Get a single vendor menu item by ID
export const getVendorMenuItemSchema = {
    description: 'Get a single vendor menu item by ID',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string', format: 'uuid' },
            itemId: { type: 'string', format: 'uuid' },
        },
        required: ['id', 'itemId'],
    },
    response: {
        200: {
            type: 'object',
            properties: {
                menuItem: { type: 'object', properties: menuItemProperties }
            }
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        500: { type: 'object', properties: { error: { type: 'string' } } }
    }
};


// Update addMenuItemSchema to accept tagIds
export const addMenuItemSchema = {
    description: 'Add menu item to vendor',
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
        required: ['name', 'price', 'categoryId', 'type'],
        properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            price: { type: 'number', minimum: 0 },
            categoryId: { type: 'string' },
            imageUrl: { type: 'string' },
            type: { type: 'string', enum: ['FOOD', 'RETAIL'] },
            prepTime: { type: 'number', minimum: 0 },
            available: { type: 'boolean', default: true },
            isAlcohol: { type: 'boolean' },
            tagIds: { type: 'array', items: { type: 'string' } } // NEW
        }
    },
    response: {
        201: {
            type: 'object',
            properties: {
                menuItem: {
                    type: 'object',
                    properties: menuItemProperties
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

// Update updateMenuItemSchema similarly
export const updateMenuItemSchema = {
    description: 'Update menu item',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            itemId: { type: 'string' }
        },
        required: ['id', 'itemId']
    },
    body: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            price: { type: 'number', minimum: 0 },
            categoryId: { type: 'string' },
            imageUrl: { type: 'string' },
            type: { type: 'string', enum: ['FOOD', 'RETAIL'] },
            prepTime: { type: 'number', minimum: 0 },
            available: { type: 'boolean' },
            isAlcohol: { type: 'boolean' },
            tagIds: { type: 'array', items: { type: 'string' } } // NEW
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                menuItem: {
                    type: 'object',
                    properties: menuItemProperties
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

export const toggleMenuItemAvailabilitySchema = {
    description: 'Toggle menu item availability',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            itemId: { type: 'string' }
        },
        required: ['id', 'itemId']
    },
    body: {
        type: 'object',
        required: ['available'],
        properties: {
            available: { type: 'boolean' }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                menuItem: {
                    type: 'object',
                    properties: menuItemProperties
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

export const deleteMenuItemSchema = {
    description: 'Delete a vendor menu item',
    tags: ['vendors'],
    params: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            itemId: { type: 'string' }
        },
        required: ['id', 'itemId']
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

// in vendor.schema.ts
// export const getVendorMenuItemSchema = {
//     params: {
//         type: 'object',
//         properties: {
//             id: { type: 'string', format: 'uuid' },
//             itemId: { type: 'string', format: 'uuid' },
//         },
//         required: ['id', 'itemId'],
//     },
// };
