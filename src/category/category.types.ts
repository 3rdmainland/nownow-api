// ============================================
// category.types.ts
// ============================================


export type CategoryType = 'VENDOR' | 'MENU_ITEM';

export interface Category {
    id: string;
    name: string;
    description?: string;
    type: CategoryType;
    createdAt: string;
    updatedAt?: string;
}
