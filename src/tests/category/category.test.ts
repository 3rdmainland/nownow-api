import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { makeCategory } from '../fixtures/index.js';
import { buildApp } from '../helpers/app.js';
import type { FastifyInstance } from 'fastify';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock }));
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }));

// Import after mocks
import { CategoryService } from '../../category/category.service.js';
import categoryController from '../../category/category.controller.js';

// ══════════════════════════════════════════════════════════════════════════════
//  SERVICE UNIT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('CategoryService', () => {
  let service: CategoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CategoryService();
  });

  // ── getAllCategories ──────────────────────────────────────────────────────────

  describe('getAllCategories', () => {
    it('returns all categories when no type filter is applied', async () => {
      const vendorCat = makeCategory({ name: 'Fast Food', type: 'VENDOR' });
      const menuCat = makeCategory({ name: 'Starters', type: 'MENU_ITEM' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [vendorCat, menuCat], error: null }),
      );

      const categories = await service.getAllCategories();

      expect(categories).toHaveLength(2);
      expect(categories[0].name).toBe('Fast Food');
      expect(categories[0].type).toBe('VENDOR');
      expect(categories[1].name).toBe('Starters');
      expect(categories[1].type).toBe('MENU_ITEM');
    });

    it('applies the type eq filter when type is VENDOR', async () => {
      const vendorCat = makeCategory({ name: 'Grills', type: 'VENDOR' });
      const mockBuilder = createSupabaseMock({ data: [vendorCat], error: null });
      supabaseMock.from.mockReturnValue(mockBuilder);

      const categories = await service.getAllCategories('VENDOR');

      expect(mockBuilder.eq).toHaveBeenCalledWith('type', 'VENDOR');
      expect(categories).toHaveLength(1);
      expect(categories[0].type).toBe('VENDOR');
    });

    it('applies the type eq filter when type is MENU_ITEM', async () => {
      const menuCat = makeCategory({ name: 'Desserts', type: 'MENU_ITEM' });
      const mockBuilder = createSupabaseMock({ data: [menuCat], error: null });
      supabaseMock.from.mockReturnValue(mockBuilder);

      const categories = await service.getAllCategories('MENU_ITEM');

      expect(mockBuilder.eq).toHaveBeenCalledWith('type', 'MENU_ITEM');
      expect(categories).toHaveLength(1);
      expect(categories[0].type).toBe('MENU_ITEM');
    });

    it('returns an empty array when no categories exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const categories = await service.getAllCategories();

      expect(categories).toEqual([]);
    });

    it('returns an empty array when data is null', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const categories = await service.getAllCategories();

      expect(categories).toEqual([]);
    });

    it('throws an error when the database query fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'query timeout' } }),
      );

      await expect(service.getAllCategories()).rejects.toThrow(
        'Failed to fetch categories: query timeout',
      );
    });

    it('correctly maps snake_case DB fields to camelCase Category fields', async () => {
      const now = new Date().toISOString();
      const dbCat = makeCategory({
        created_at: now,
        updated_at: now,
        name: 'Mapped Category',
        type: 'VENDOR',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [dbCat], error: null }),
      );

      const [category] = await service.getAllCategories();

      expect(category.createdAt).toBe(now);
      expect(category.updatedAt).toBe(now);
      expect(category.name).toBe('Mapped Category');
    });
  });

  // ── getCategoryById ───────────────────────────────────────────────────────────

  describe('getCategoryById', () => {
    it('returns the mapped category when found', async () => {
      const dbCat = makeCategory({ id: 'cat-uuid-001', name: 'Beverages', type: 'MENU_ITEM' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbCat, error: null }),
      );

      const category = await service.getCategoryById('cat-uuid-001');

      expect(category).not.toBeNull();
      expect(category!.id).toBe('cat-uuid-001');
      expect(category!.name).toBe('Beverages');
      expect(category!.type).toBe('MENU_ITEM');
    });

    it('returns null when data is null and no error occurs', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const category = await service.getCategoryById('nonexistent-id');

      expect(category).toBeNull();
    });

    it('throws when the database query fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'row not found' } }),
      );

      await expect(service.getCategoryById('bad-id')).rejects.toThrow(
        'Failed to fetch category: row not found',
      );
    });
  });

  // ── createCategory ────────────────────────────────────────────────────────────

  describe('createCategory', () => {
    it('inserts the category and returns the mapped result', async () => {
      const dbCat = makeCategory({
        id: 'new-cat-id',
        name: 'Street Food',
        type: 'VENDOR',
        description: 'Outdoor street vendors',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbCat, error: null }),
      );

      const category = await service.createCategory({
        name: 'Street Food',
        type: 'VENDOR',
        description: 'Outdoor street vendors',
      });

      expect(category).toMatchObject({
        id: 'new-cat-id',
        name: 'Street Food',
        type: 'VENDOR',
        description: 'Outdoor street vendors',
      });
    });

    it('throws when the database insert fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'duplicate name' } }),
      );

      await expect(
        service.createCategory({ name: 'Duplicate', type: 'VENDOR' }),
      ).rejects.toThrow('Failed to create category: duplicate name');
    });
  });

  // ── updateCategory ────────────────────────────────────────────────────────────

  describe('updateCategory', () => {
    it('updates the category and returns the mapped result', async () => {
      const updatedDbCat = makeCategory({
        id: 'cat-to-update',
        name: 'Renamed Category',
        type: 'MENU_ITEM',
        description: 'Updated description',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: updatedDbCat, error: null }),
      );

      const category = await service.updateCategory('cat-to-update', {
        name: 'Renamed Category',
        description: 'Updated description',
      });

      expect(category).toMatchObject({
        id: 'cat-to-update',
        name: 'Renamed Category',
        type: 'MENU_ITEM',
      });
    });

    it('throws when the database update fails (category not found)', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'no rows returned' } }),
      );

      await expect(
        service.updateCategory('ghost-cat-id', { name: 'Ghost' }),
      ).rejects.toThrow('Failed to update category: no rows returned');
    });
  });

  // ── deleteCategory ────────────────────────────────────────────────────────────

  describe('deleteCategory', () => {
    it('resolves without error on successful deletion', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      await expect(service.deleteCategory('cat-to-delete')).resolves.toBeUndefined();
    });

    it('throws when the deletion fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'foreign key violation' } }),
      );

      await expect(service.deleteCategory('constrained-cat-id')).rejects.toThrow(
        'Failed to delete category: foreign key violation',
      );
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  CONTROLLER INTEGRATION TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Category Controller (integration)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp(async (fastify) => {
      fastify.register(categoryController, { prefix: '/category' });
    });
  });

  // ── GET /category ─────────────────────────────────────────────────────────────

  describe('GET /category', () => {
    it('returns 200 with all categories', async () => {
      const cat1 = makeCategory({ name: 'Fast Food', type: 'VENDOR' });
      const cat2 = makeCategory({ name: 'Mains', type: 'MENU_ITEM' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [cat1, cat2], error: null }),
      );

      const res = await app.inject({ method: 'GET', url: '/category' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('categories');
      expect(body.categories).toHaveLength(2);
      expect(body.categories[0].name).toBe('Fast Food');
    });

    it('returns 200 with an empty array when there are no categories', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: [], error: null }),
      );

      const res = await app.inject({ method: 'GET', url: '/category' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ categories: [] });
    });

    it('returns 500 when the service throws', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'db error' } }),
      );

      const res = await app.inject({ method: 'GET', url: '/category' });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /category?type=VENDOR ─────────────────────────────────────────────────

  describe('GET /category?type=VENDOR', () => {
    it('returns 200 with only VENDOR categories', async () => {
      const vendorCat = makeCategory({ name: 'BBQ', type: 'VENDOR' });
      const mockBuilder = createSupabaseMock({ data: [vendorCat], error: null });
      supabaseMock.from.mockReturnValue(mockBuilder);

      const res = await app.inject({ method: 'GET', url: '/category?type=VENDOR' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.categories).toHaveLength(1);
      expect(body.categories[0].type).toBe('VENDOR');
      // Confirm the service applied the filter
      expect(mockBuilder.eq).toHaveBeenCalledWith('type', 'VENDOR');
    });

    it('returns 200 with only MENU_ITEM categories when type=MENU_ITEM', async () => {
      const menuCat = makeCategory({ name: 'Desserts', type: 'MENU_ITEM' });
      const mockBuilder = createSupabaseMock({ data: [menuCat], error: null });
      supabaseMock.from.mockReturnValue(mockBuilder);

      const res = await app.inject({ method: 'GET', url: '/category?type=MENU_ITEM' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.categories[0].type).toBe('MENU_ITEM');
      expect(mockBuilder.eq).toHaveBeenCalledWith('type', 'MENU_ITEM');
    });

    it('returns 400 when an invalid type query param is passed', async () => {
      const res = await app.inject({ method: 'GET', url: '/category?type=INVALID' });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /category/:id ─────────────────────────────────────────────────────────

  describe('GET /category/:id', () => {
    it('returns 200 with the category when found', async () => {
      const dbCat = makeCategory({ id: 'cat-known-id', name: 'Salads' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbCat, error: null }),
      );

      const res = await app.inject({ method: 'GET', url: '/category/cat-known-id' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('category');
      expect(body.category.id).toBe('cat-known-id');
      expect(body.category.name).toBe('Salads');
    });

    it('returns 404 when the category does not exist', async () => {
      // Use no-error null response so service returns null (not throws)
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({ method: 'GET', url: '/category/ghost-id' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Category not found' });
    });

    it('returns 500 when the service throws unexpectedly', async () => {
      const brokenBuilder = createSupabaseMock({ data: null, error: null });
      (brokenBuilder.single as any).mockRejectedValueOnce(new Error('network error'));
      supabaseMock.from.mockReturnValue(brokenBuilder);

      const res = await app.inject({ method: 'GET', url: '/category/crash-id' });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /category ────────────────────────────────────────────────────────────

  describe('POST /category', () => {
    it('returns 201 with the created category', async () => {
      const dbCat = makeCategory({
        id: 'created-cat-id',
        name: 'Vegan',
        type: 'VENDOR',
        description: 'Plant-based vendors',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: dbCat, error: null }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/category',
        payload: { name: 'Vegan', type: 'VENDOR', description: 'Plant-based vendors' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('category');
      expect(body.category.name).toBe('Vegan');
      expect(body.category.type).toBe('VENDOR');
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/category',
        payload: { type: 'VENDOR' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when type is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/category',
        payload: { name: 'Missing Type' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when type is not a valid CategoryType value', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/category',
        payload: { name: 'Bad Type', type: 'SOMETHING_ELSE' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 500 when the database insert fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'insert conflict' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/category',
        payload: { name: 'Conflict Cat', type: 'MENU_ITEM' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── PUT /category/:id ─────────────────────────────────────────────────────────

  describe('PUT /category/:id', () => {
    it('returns 200 with the updated category', async () => {
      const updatedDbCat = makeCategory({
        id: 'cat-put-id',
        name: 'Updated Name',
        type: 'MENU_ITEM',
        description: 'New description',
      });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: updatedDbCat, error: null }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/category/cat-put-id',
        payload: { name: 'Updated Name', description: 'New description' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('category');
      expect(body.category.id).toBe('cat-put-id');
      expect(body.category.name).toBe('Updated Name');
    });

    it('returns 500 when the category to update does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'not found' } }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/category/ghost-cat',
        payload: { name: 'Ghost' },
      });

      expect(res.statusCode).toBe(500);
    });

    it('returns 400 when an invalid type is provided in the body', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/category/cat-put-id',
        payload: { type: 'INVALID_TYPE' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── DELETE /category/:id ──────────────────────────────────────────────────────

  describe('DELETE /category/:id', () => {
    it('returns 204 on successful deletion', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: null }),
      );

      const res = await app.inject({ method: 'DELETE', url: '/category/cat-to-delete' });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
    });

    it('returns 500 when deletion fails', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'deletion blocked' } }),
      );

      const res = await app.inject({ method: 'DELETE', url: '/category/locked-cat' });

      expect(res.statusCode).toBe(500);
    });
  });
});
