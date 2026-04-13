import type { FastifyPluginAsync } from 'fastify';
import { authenticateVendor, assertVendorRole } from '../lib/auth.js';
import {
  InviteStaffSchema,
  UpdateStaffRoleSchema,
  StaffParamsSchema,
  StaffUserParamsSchema,
} from './staff.schema.js';
import * as staffService from './staff.service.js';
import type { InviteStaffDto, UpdateStaffRoleDto } from './staff.types.js';

const staffController: FastifyPluginAsync = async (fastify) => {
  // GET /vendor/:id/staff — list staff (owner only)
  fastify.get<{ Params: { id: string } }>(
    '/:id/staff',
    {
      preHandler: [authenticateVendor, assertVendorRole(['owner'])],
      schema: { params: StaffParamsSchema },
    },
    async (request) => {
      const staff = await staffService.listStaff(request.params.id);
      return { staff };
    }
  );

  // POST /vendor/:id/staff/invite — invite staff (owner only)
  fastify.post<{ Params: { id: string }; Body: InviteStaffDto }>(
    '/:id/staff/invite',
    {
      preHandler: [authenticateVendor, assertVendorRole(['owner'])],
      schema: { params: StaffParamsSchema, body: InviteStaffSchema },
    },
    async (request) => {
      const user = request.user as { userId: string };
      const invite = await staffService.inviteStaff(
        request.params.id,
        user.userId,
        request.body
      );
      return { invite };
    }
  );

  // PATCH /vendor/:id/staff/:userId — change role (owner only)
  fastify.patch<{ Params: { id: string; userId: string }; Body: UpdateStaffRoleDto }>(
    '/:id/staff/:userId',
    {
      preHandler: [authenticateVendor, assertVendorRole(['owner'])],
      schema: { params: StaffUserParamsSchema, body: UpdateStaffRoleSchema },
    },
    async (request, reply) => {
      await staffService.updateStaffRole(
        request.params.id,
        request.params.userId,
        request.body
      );
      return reply.status(204).send();
    }
  );

  // DELETE /vendor/:id/staff/:userId — remove staff (owner only)
  fastify.delete<{ Params: { id: string; userId: string } }>(
    '/:id/staff/:userId',
    {
      preHandler: [authenticateVendor, assertVendorRole(['owner'])],
      schema: { params: StaffUserParamsSchema },
    },
    async (request, reply) => {
      await staffService.removeStaff(request.params.id, request.params.userId);
      return reply.status(204).send();
    }
  );
};

export default staffController;
