import { randomBytes } from 'crypto';
import { supabase } from '../lib/supabase.js';
import { AppError, NotFoundError, ConflictError, ForbiddenError } from '../lib/errors.js';
import type {
  StaffMember,
  StaffInvite,
  InviteStaffDto,
  UpdateStaffRoleDto,
  VendorUserRole,
} from './staff.types.js';

export async function listStaff(vendorId: string): Promise<StaffMember[]> {
  const { data, error } = await supabase
    .from('vendor_user_roles')
    .select(`
      id,
      user_id,
      role,
      created_at,
      vendor_users:user_id (email)
    `)
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: true });

  if (error) throw new AppError(error.message, 500);

  return (data || []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    email: row.vendor_users?.email || '',
    role: row.role,
    createdAt: row.created_at,
  }));
}

export async function inviteStaff(
  vendorId: string,
  invitedBy: string,
  dto: InviteStaffDto
): Promise<StaffInvite> {
  // Check if user already has a role on this vendor
  const { data: existingUser } = await supabase
    .from('vendor_users')
    .select('id')
    .eq('email', dto.email)
    .maybeSingle();

  if (existingUser) {
    const { data: existingRole } = await supabase
      .from('vendor_user_roles')
      .select('id')
      .eq('vendor_id', vendorId)
      .eq('user_id', existingUser.id)
      .maybeSingle();

    if (existingRole) {
      throw new ConflictError('User already has a role on this vendor');
    }
  }

  // Check for existing pending invite
  const { data: pendingInvite } = await supabase
    .from('vendor_staff_invites')
    .select('id')
    .eq('vendor_id', vendorId)
    .eq('email', dto.email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (pendingInvite) {
    throw new ConflictError('Pending invite already exists for this email');
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('vendor_staff_invites')
    .insert({
      vendor_id: vendorId,
      invited_by: invitedBy,
      email: dto.email,
      role: dto.role,
      token,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);

  return {
    id: data.id,
    vendorId: data.vendor_id,
    invitedBy: data.invited_by,
    email: data.email,
    role: data.role,
    token: data.token,
    expiresAt: data.expires_at,
    acceptedAt: data.accepted_at,
    createdAt: data.created_at,
  };
}

export async function validateStaffInvite(token: string): Promise<StaffInvite & { vendorName: string }> {
  const { data, error } = await supabase
    .from('vendor_staff_invites')
    .select(`
      *,
      vendors:vendor_id (name)
    `)
    .eq('token', token)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !data) {
    throw new NotFoundError('Invalid or expired invite');
  }

  return {
    id: data.id,
    vendorId: data.vendor_id,
    invitedBy: data.invited_by,
    email: data.email,
    role: data.role,
    token: data.token,
    expiresAt: data.expires_at,
    acceptedAt: data.accepted_at,
    createdAt: data.created_at,
    vendorName: data.vendors?.name || '',
  };
}

export async function acceptStaffInvite(token: string, userId: string): Promise<VendorUserRole> {
  const invite = await validateStaffInvite(token);

  const { data: role, error: roleError } = await supabase
    .from('vendor_user_roles')
    .insert({
      user_id: userId,
      vendor_id: invite.vendorId,
      role: invite.role,
    })
    .select()
    .single();

  if (roleError) throw new AppError(roleError.message, 500);

  // Mark invite as accepted
  await supabase
    .from('vendor_staff_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  return {
    id: role.id,
    userId: role.user_id,
    vendorId: role.vendor_id,
    role: role.role,
    createdAt: role.created_at,
    updatedAt: role.updated_at,
  };
}

export async function updateStaffRole(
  vendorId: string,
  userId: string,
  dto: UpdateStaffRoleDto
): Promise<void> {
  const { data: existing } = await supabase
    .from('vendor_user_roles')
    .select('role')
    .eq('vendor_id', vendorId)
    .eq('user_id', userId)
    .single();

  if (!existing) throw new NotFoundError('Staff member not found');
  if (existing.role === 'owner') throw new ForbiddenError('Cannot change owner role');

  const { error } = await supabase
    .from('vendor_user_roles')
    .update({ role: dto.role, updated_at: new Date().toISOString() })
    .eq('vendor_id', vendorId)
    .eq('user_id', userId);

  if (error) throw new AppError(error.message, 500);
}

export async function removeStaff(vendorId: string, userId: string): Promise<void> {
  const { data: existing } = await supabase
    .from('vendor_user_roles')
    .select('role')
    .eq('vendor_id', vendorId)
    .eq('user_id', userId)
    .single();

  if (!existing) throw new NotFoundError('Staff member not found');
  if (existing.role === 'owner') throw new ForbiddenError('Cannot remove owner');

  const { error } = await supabase
    .from('vendor_user_roles')
    .delete()
    .eq('vendor_id', vendorId)
    .eq('user_id', userId);

  if (error) throw new AppError(error.message, 500);
}
