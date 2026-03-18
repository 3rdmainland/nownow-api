// ============================================
// category.types.ts
// ============================================


export type CategoryType = 'VENDOR';

export interface Category {
    id: string;
    name: string;
    description?: string;
    type: CategoryType;
    createdAt: string;
    updatedAt?: string;
}
