// ============================================
// category.utils.ts
// ============================================

import {Category} from "./category.types";

export function toDbCategory(category: Partial<Category>) {
    return {
        name: category.name,
        description: category.description,
        type: category.type
    };
}

export function fromDbCategory(dbCategory: any): Category {
    return {
        id: dbCategory.id,
        name: dbCategory.name,
        description: dbCategory.description,
        type: dbCategory.type,
        createdAt: dbCategory.created_at,
        updatedAt: dbCategory.updated_at
    };
}
