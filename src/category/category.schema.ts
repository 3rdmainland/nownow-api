// ============================================
// category.schema.ts
// ============================================

const categoryProperties = {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    type: { type: 'string', enum: ['VENDOR'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
};

export const getCategoriesSchema = {
    description: 'Get all categories',
    tags: ['categories'],
    querystring: {
        type: 'object',
        properties: {
            type: { type: 'string', enum: ['VENDOR'] }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                categories: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: categoryProperties
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

export const getCategoryByIdSchema = {
    description: 'Get category by ID',
    tags: ['categories'],
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
                category: {
                    type: 'object',
                    properties: categoryProperties
                }
            }
        },
        404: {
            type: 'object',
            properties: { error: { type: 'string' } }
        },
        500: {
            type: 'object',
            properties: { error: { type: 'string' } }
        }
    }
};

export const createCategorySchema = {
    description: 'Create new category',
    tags: ['categories'],
    body: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['VENDOR'] }
        }
    },
    response: {
        201: {
            type: 'object',
            properties: {
                category: {
                    type: 'object',
                    properties: categoryProperties
                }
            }
        },
        500: {
            type: 'object',
            properties: { error: { type: 'string' } }
        }
    }
};

export const updateCategorySchema = {
    description: 'Update category',
    tags: ['categories'],
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
            type: { type: 'string', enum: ['VENDOR'] }
        }
    },
    response: {
        200: {
            type: 'object',
            properties: {
                category: {
                    type: 'object',
                    properties: categoryProperties
                }
            }
        },
        500: {
            type: 'object',
            properties: { error: { type: 'string' } }
        }
    }
};

export const deleteCategorySchema = {
    description: 'Delete category',
    tags: ['categories'],
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
            properties: { error: { type: 'string' } }
        }
    }
};
