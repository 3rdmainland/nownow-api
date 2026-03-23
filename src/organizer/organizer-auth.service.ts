import { supabase } from '../lib/supabase.js';
import {
  OrganizerLoginPayload,
  OrganizerRegisterPayload,
  OrganizerInvitePayload,
  OrganizerUpdateProfilePayload,
  SafeOrganizerUser,
} from './organizer-auth.types.js';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from '../lib/errors.js';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

const INVITE_EXPIRY_DAYS = 7;
const SALT_ROUNDS = 10;

export class OrganizerAuthService {
  async createInvite(payload: OrganizerInvitePayload): Promise<{ inviteToken: string; expiresAt: string }> {
    // Check if a user already exists with this email
    const { data: existingUser } = await supabase
      .from('organizer_users')
      .select('id')
      .eq('email', payload.email)
      .single();

    if (existingUser) {
      throw new ConflictError('An organizer with this email already exists');
    }

    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('organizer_invites')
      .insert([{
        email: payload.email,
        token,
        expires_at: expiresAt,
      }]);

    if (error) {
      throw new Error(`Failed to create invite: ${error.message}`);
    }

    return { inviteToken: token, expiresAt };
  }

  async validateInvite(token: string): Promise<{ email: string }> {
    const { data: invite, error } = await supabase
      .from('organizer_invites')
      .select('email, expires_at, used_at')
      .eq('token', token)
      .single();

    if (error || !invite) {
      throw new NotFoundError('Invalid invite token');
    }

    if (invite.used_at) {
      throw new ValidationError('Invite has already been used');
    }

    if (new Date(invite.expires_at) < new Date()) {
      throw new ValidationError('Invite has expired');
    }

    return { email: invite.email };
  }

  async register(payload: OrganizerRegisterPayload): Promise<SafeOrganizerUser> {
    const { data: invite, error: inviteErr } = await supabase
      .from('organizer_invites')
      .select('*')
      .eq('token', payload.token)
      .single();

    if (inviteErr || !invite) {
      throw new ValidationError('Invalid invite token');
    }

    if (invite.used_at) {
      throw new ValidationError('Invite has already been used');
    }

    if (new Date(invite.expires_at) < new Date()) {
      throw new ValidationError('Invite has expired');
    }

    const { data: existing } = await supabase
      .from('organizer_users')
      .select('id')
      .eq('email', invite.email)
      .single();

    if (existing) {
      throw new ConflictError('Email already registered');
    }

    const passwordHash = await bcrypt.hash(payload.password, SALT_ROUNDS);

    const { data, error } = await supabase
      .from('organizer_users')
      .insert([{
        email: invite.email,
        name: payload.name,
        password_hash: passwordHash,
      }])
      .select('id, email, name, phone, organization, created_at, updated_at')
      .single();

    if (error) {
      throw new Error(`Registration failed: ${error.message}`);
    }

    await supabase
      .from('organizer_invites')
      .update({ used_at: new Date().toISOString() })
      .eq('token', payload.token);

    return {
      id: data.id,
      email: data.email,
      name: data.name,
      phone: data.phone,
      organization: data.organization,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async login(payload: OrganizerLoginPayload): Promise<SafeOrganizerUser> {
    const { data, error } = await supabase
      .from('organizer_users')
      .select('*')
      .eq('email', payload.email)
      .single();

    if (error || !data) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const valid = await bcrypt.compare(payload.password, data.password_hash);
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    return {
      id: data.id,
      email: data.email,
      name: data.name,
      phone: data.phone,
      organization: data.organization,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async getUserById(userId: string): Promise<SafeOrganizerUser | null> {
    const { data, error } = await supabase
      .from('organizer_users')
      .select('id, email, name, phone, organization, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      email: data.email,
      name: data.name,
      phone: data.phone,
      organization: data.organization,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async updateProfile(userId: string, payload: OrganizerUpdateProfilePayload): Promise<SafeOrganizerUser> {
    const updateData: Record<string, string> = { updated_at: new Date().toISOString() };
    if (payload.name !== undefined) updateData.name = payload.name;
    if (payload.phone !== undefined) updateData.phone = payload.phone;
    if (payload.organization !== undefined) updateData.organization = payload.organization;

    const { data, error } = await supabase
      .from('organizer_users')
      .update(updateData)
      .eq('id', userId)
      .select('id, email, name, phone, organization, created_at, updated_at')
      .single();

    if (error || !data) {
      throw new Error(`Failed to update profile: ${error?.message || 'User not found'}`);
    }

    return {
      id: data.id,
      email: data.email,
      name: data.name,
      phone: data.phone,
      organization: data.organization,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async createPasswordReset(email: string): Promise<{ token: string }> {
    // Silently succeed even if email doesn't exist (prevents email enumeration)
    const { data: user } = await supabase
      .from('organizer_users')
      .select('id')
      .eq('email', email)
      .single();

    if (!user) {
      return { token: '' };
    }

    // Invalidate any existing unused tokens for this email
    await supabase
      .from('organizer_password_resets')
      .update({ used_at: new Date().toISOString() })
      .eq('email', email)
      .is('used_at', null);

    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    const { error } = await supabase
      .from('organizer_password_resets')
      .insert([{ email, token, expires_at: expiresAt }]);

    if (error) {
      throw new Error(`Failed to create reset token: ${error.message}`);
    }

    return { token };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { data: reset, error } = await supabase
      .from('organizer_password_resets')
      .select('email, expires_at, used_at')
      .eq('token', token)
      .single();

    if (error || !reset) {
      throw new NotFoundError('Invalid or expired reset token');
    }

    if (reset.used_at) {
      throw new ValidationError('Reset token has already been used');
    }

    if (new Date(reset.expires_at) < new Date()) {
      throw new ValidationError('Reset token has expired');
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const { error: updateErr } = await supabase
      .from('organizer_users')
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('email', reset.email);

    if (updateErr) {
      throw new Error(`Failed to reset password: ${updateErr.message}`);
    }

    await supabase
      .from('organizer_password_resets')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);
  }

  async adminResetPassword(email: string, newPassword: string): Promise<void> {
    const { data, error } = await supabase
      .from('organizer_users')
      .select('id')
      .eq('email', email)
      .single();

    if (error || !data) {
      throw new NotFoundError('Organizer not found');
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const { error: updateErr } = await supabase
      .from('organizer_users')
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('id', data.id);

    if (updateErr) {
      throw new Error(`Failed to reset password: ${updateErr.message}`);
    }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const { data, error } = await supabase
      .from('organizer_users')
      .select('id, password_hash')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundError('User not found');
    }

    const valid = await bcrypt.compare(currentPassword, data.password_hash);
    if (!valid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const { error: updateErr } = await supabase
      .from('organizer_users')
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateErr) {
      throw new Error(`Failed to update password: ${updateErr.message}`);
    }
  }
}
