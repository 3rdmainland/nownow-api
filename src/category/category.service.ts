// ============================================
// category.service.ts
// ============================================

import { supabase } from '../../supabase';
import { Category, CategoryType } from './category.types';
import { toDbCategory, fromDbCategory } from './utils';

export class CategoryService {
    async getAllCategories(type?: CategoryType): Promise<Category[]> {
        let query = supabase.from('categories').select('*');

        if (type) {
            query = query.eq('type', type);
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(`Failed to fetch categories: ${error.message}`);
        }

        return (data || []).map(fromDbCategory);
    }

    async getCategoryById(id: string): Promise<Category | null> {
        const { data, error } = await supabase
            .from('categories')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            throw new Error(`Failed to fetch category: ${error.message}`);
        }

        return data ? fromDbCategory(data) : null;
    }

    async createCategory(category: Omit<Category, 'id' | 'createdAt'>): Promise<Category> {
        const dbCategory = toDbCategory(category);

        const { data, error } = await supabase
            .from('categories')
            .insert([dbCategory])
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to create category: ${error.message}`);
        }

        return fromDbCategory(data);
    }

    async updateCategory(id: string, category: Partial<Category>): Promise<Category> {
        const dbCategory = toDbCategory(category);

        const { data, error } = await supabase
            .from('categories')
            .update(dbCategory)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to update category: ${error.message}`);
        }

        return fromDbCategory(data);
    }

    async deleteCategory(id: string): Promise<void> {
        const { error } = await supabase
            .from('categories')
            .delete()
            .eq('id', id);

        if (error) {
            throw new Error(`Failed to delete category: ${error.message}`);
        }
    }
}
