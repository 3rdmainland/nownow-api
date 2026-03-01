// ============================================
// category.service.ts
// ============================================

import { supabase } from '../lib/supabase';
import { Category, CategoryType } from './category.types';
import { toDbCategory, fromDbCategory } from './utils';
import { cache } from '../lib/redis';

const CATEGORY_CACHE_TTL = 3600; // 60 minutes — categories rarely change

const categoryCacheKeys = {
    all: (type?: string) => `categories:all${type ? `:${type}` : ''}`,
    byId: (id: string) => `categories:id:${id}`,
} as const;

export class CategoryService {
    async getAllCategories(type?: CategoryType): Promise<Category[]> {
        const cacheKey = categoryCacheKeys.all(type);
        const cached = await cache.get<Category[]>(cacheKey);
        if (cached) return cached;

        let query = supabase.from('categories').select('*');

        if (type) {
            query = query.eq('type', type);
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(`Failed to fetch categories: ${error.message}`);
        }

        const categories = (data || []).map(fromDbCategory);
        await cache.set(cacheKey, categories, CATEGORY_CACHE_TTL);
        return categories;
    }

    async getCategoryById(id: string): Promise<Category | null> {
        const cacheKey = categoryCacheKeys.byId(id);
        const cached = await cache.get<Category>(cacheKey);
        if (cached) return cached;

        const { data, error } = await supabase
            .from('categories')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            throw new Error(`Failed to fetch category: ${error.message}`);
        }

        const category = data ? fromDbCategory(data) : null;
        if (category) await cache.set(cacheKey, category, CATEGORY_CACHE_TTL);
        return category;
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

        const created = fromDbCategory(data);
        await this.invalidateCategoryCaches(created.id);
        return created;
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

        const updated = fromDbCategory(data);
        await this.invalidateCategoryCaches(id);
        return updated;
    }

    async deleteCategory(id: string): Promise<void> {
        const { error } = await supabase
            .from('categories')
            .delete()
            .eq('id', id);

        if (error) {
            throw new Error(`Failed to delete category: ${error.message}`);
        }

        await this.invalidateCategoryCaches(id);
    }

    private async invalidateCategoryCaches(id?: string): Promise<void> {
        const keys = [categoryCacheKeys.all()];
        if (id) keys.push(categoryCacheKeys.byId(id));
        // Also invalidate typed variants
        keys.push(categoryCacheKeys.all('VENDOR'), categoryCacheKeys.all('MENU'));
        try {
            await cache.del(...keys);
        } catch {
            // Cache invalidation failure should not break the operation
        }
    }
}
