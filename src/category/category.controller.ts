// ============================================
// category.controller.ts
// ============================================

import { FastifyPluginAsync } from 'fastify';
import { CategoryService } from './category.service';
import {
    getCategoriesSchema,
    getCategoryByIdSchema,
    createCategorySchema,
    updateCategorySchema,
    deleteCategorySchema
} from './category.schema';
import { CategoryType } from './category.types';
import { authenticateAdmin } from '../lib/auth.js';

const categoryController: FastifyPluginAsync = async (fastify) => {
    const categoryService = new CategoryService();

    // GET all categories (optionally filter by type)
    fastify.get<{ Querystring: { type?: CategoryType } }>(
        '/',
        { schema: getCategoriesSchema },
        async (request, reply) => {
            try {
                const categories = await categoryService.getAllCategories(request.query.type);
                return reply.status(200).send({ categories });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: 'Internal server error' });
            }
        }
    );

    // GET category by ID
    fastify.get<{ Params: { id: string } }>(
        '/:id',
        { schema: getCategoryByIdSchema },
        async (request, reply) => {
            try {
                const category = await categoryService.getCategoryById(request.params.id);

                if (!category) {
                    return reply.status(404).send({ error: 'Category not found' });
                }

                return reply.status(200).send({ category });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: 'Internal server error' });
            }
        }
    );

    // POST create category (admin only)
    fastify.post(
        '/',
        { schema: createCategorySchema, preHandler: [authenticateAdmin] },
        async (request, reply) => {
            try {
                const category = await categoryService.createCategory(request.body as any);
                return reply.status(201).send({ category });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: 'Internal server error' });
            }
        }
    );

    // PUT update category (admin only)
    fastify.put<{ Params: { id: string } }>(
        '/:id',
        { schema: updateCategorySchema, preHandler: [authenticateAdmin] },
        async (request, reply) => {
            try {
                const category = await categoryService.updateCategory(
                    request.params.id,
                    request.body as any
                );
                return reply.status(200).send({ category });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: 'Internal server error' });
            }
        }
    );

    // DELETE category (admin only)
    fastify.delete<{ Params: { id: string } }>(
        '/:id',
        { schema: deleteCategorySchema, preHandler: [authenticateAdmin] },
        async (request, reply) => {
            try {
                await categoryService.deleteCategory(request.params.id);
                return reply.status(204).send();
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ error: 'Internal server error' });
            }
        }
    );
};

export default categoryController;
