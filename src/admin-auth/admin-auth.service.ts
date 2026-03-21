import { supabase } from '../lib/supabase.js';
import { AdminLoginPayload, SafeAdminUser } from './admin-auth.types.js';
import {
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
} from '../lib/errors.js';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export class AdminAuthService {
  async login(payload: AdminLoginPayload): Promise<SafeAdminUser> {
    const { data, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('email', payload.email)
      .single();

    if (error || !data) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!data.is_active) {
      throw new ForbiddenError('Account is deactivated');
    }

    const valid = await bcrypt.compare(payload.password, data.password_hash);
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    return {
      id: data.id,
      email: data.email,
      name: data.name,
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async getUserById(userId: string): Promise<SafeAdminUser | null> {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, email, name, is_active, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      email: data.email,
      name: data.name,
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const { data, error } = await supabase
      .from('admin_users')
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
      .from('admin_users')
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateErr) {
      throw new Error(`Failed to update password: ${updateErr.message}`);
    }
  }
}
