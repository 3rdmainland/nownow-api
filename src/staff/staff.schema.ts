import { Type } from '@sinclair/typebox';

export const InviteStaffSchema = Type.Object({
  email: Type.String({ format: 'email' }),
  role: Type.Union([Type.Literal('manager'), Type.Literal('staff')]),
});

export const UpdateStaffRoleSchema = Type.Object({
  role: Type.Union([Type.Literal('manager'), Type.Literal('staff')]),
});

export const StaffParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const StaffUserParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  userId: Type.String({ format: 'uuid' }),
});

export const StaffInviteTokenParamsSchema = Type.Object({
  token: Type.String(),
});
