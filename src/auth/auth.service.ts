import { supabase } from '../lib/supabase.js';
import {
  RegisterPayload,
  LoginPayload,
  InvitePayload,
  RegisterVendorPayload,
  SafeVendorUser,
} from './auth.types.js';
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

export class AuthService {
  async createInvite(payload: InvitePayload): Promise<{ inviteToken: string; expiresAt: string }> {
    // Verify vendor exists
    const { data: vendor, error: vendorErr } = await supabase
      .from('vendors')
      .select('id')
      .eq('id', payload.vendorId)
      .single();

    if (vendorErr || !vendor) {
      throw new NotFoundError('Vendor not found', { vendorId: payload.vendorId });
    }

    // Check if a user already exists with this email
    const { data: existingUser } = await supabase
      .from('vendor_users')
      .select('id')
      .eq('email', payload.email)
      .single();

    if (existingUser) {
      throw new ConflictError('A user with this email already exists');
    }

    // Generate invite token
    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('vendor_invites')
      .insert([{
        vendor_id: payload.vendorId,
        email: payload.email,
        token,
        expires_at: expiresAt,
      }]);

    if (error) {
      throw new Error(`Failed to create invite: ${error.message}`);
    }

    return { inviteToken: token, expiresAt };
  }

  async validateInvite(token: string): Promise<{ email: string; vendorName: string }> {
    const { data: invite, error } = await supabase
      .from('vendor_invites')
      .select('email, vendor_id, expires_at, used_at')
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

    // Get vendor name
    const { data: vendor } = await supabase
      .from('vendors')
      .select('name')
      .eq('id', invite.vendor_id)
      .single();

    return {
      email: invite.email,
      vendorName: vendor?.name || 'Unknown Vendor',
    };
  }

  async register(payload: RegisterPayload): Promise<SafeVendorUser> {
    // Validate invite token
    const { data: invite, error: inviteErr } = await supabase
      .from('vendor_invites')
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

    // Check if email already registered
    const { data: existing } = await supabase
      .from('vendor_users')
      .select('id')
      .eq('email', invite.email)
      .single();

    if (existing) {
      throw new ConflictError('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(payload.password, SALT_ROUNDS);

    // Insert user
    const { data, error } = await supabase
      .from('vendor_users')
      .insert([{
        vendor_id: invite.vendor_id,
        email: invite.email,
        password_hash: passwordHash,
      }])
      .select('id, vendor_id, email, created_at, updated_at')
      .single();

    if (error) {
      throw new Error(`Registration failed: ${error.message}`);
    }

    // Mark invite as used
    await supabase
      .from('vendor_invites')
      .update({ used_at: new Date().toISOString() })
      .eq('token', payload.token);

    return {
      id: data.id,
      vendorId: data.vendor_id,
      email: data.email,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async login(payload: LoginPayload): Promise<SafeVendorUser & { vendors: Array<{ vendorId: string; vendorName: string; role: string; logoUrl: string | null }> }> {
    const { data, error } = await supabase
      .from('vendor_users')
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

    const { data: roles } = await supabase
      .from('vendor_user_roles')
      .select(`
        vendor_id,
        role,
        vendors:vendor_id (id, name, logo_url)
      `)
      .eq('user_id', data.id);

    let vendors = (roles || []).map((r: any) => ({
      vendorId: r.vendor_id,
      vendorName: r.vendors?.name || '',
      role: r.role,
      logoUrl: r.vendors?.logo_url || null,
    }));

    // Fallback: if no roles exist but user has a vendor_id, fetch vendor directly
    if (vendors.length === 0 && data.vendor_id) {
      const { data: vendor } = await supabase
        .from('vendors')
        .select('id, name, logo_url')
        .eq('id', data.vendor_id)
        .single();
      if (vendor) {
        vendors = [{
          vendorId: vendor.id,
          vendorName: vendor.name || '',
          role: 'owner',
          logoUrl: vendor.logo_url || null,
        }];
      }
    }

    return {
      id: data.id,
      vendorId: data.vendor_id,
      email: data.email,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      vendors,
    };
  }

  async registerWithInvite(payload: { email: string; password: string; vendorId: string }): Promise<SafeVendorUser> {
    // Check if email already registered
    const { data: existing } = await supabase
      .from('vendor_users')
      .select('id')
      .eq('email', payload.email)
      .single();

    if (existing) {
      throw new ConflictError('Email already registered');
    }

    const passwordHash = await bcrypt.hash(payload.password, SALT_ROUNDS);

    const { data, error } = await supabase
      .from('vendor_users')
      .insert([{
        vendor_id: payload.vendorId,
        email: payload.email,
        password_hash: passwordHash,
      }])
      .select('id, vendor_id, email, created_at, updated_at')
      .single();

    if (error) {
      throw new Error(`Registration failed: ${error.message}`);
    }

    return {
      id: data.id,
      vendorId: data.vendor_id,
      email: data.email,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async registerVendor(payload: RegisterVendorPayload): Promise<SafeVendorUser & { vendors: Array<{ vendorId: string; vendorName: string; role: string; logoUrl: string | null }> }> {
    const { data: existing } = await supabase
      .from('vendor_users')
      .select('id')
      .eq('email', payload.email)
      .single();

    if (existing) {
      throw new ConflictError('Email already registered');
    }

    const { data: vendor, error: vendorError } = await supabase
      .from('vendors')
      .insert({
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        payment_methods: ['CASH'],
        is_active: true,
      })
      .select('id, name')
      .single();

    if (vendorError || !vendor) {
      throw new Error(`Failed to create vendor: ${vendorError?.message}`);
    }

    const passwordHash = await bcrypt.hash(payload.password, SALT_ROUNDS);
    const { data: user, error: userError } = await supabase
      .from('vendor_users')
      .insert({
        vendor_id: vendor.id,
        email: payload.email,
        password_hash: passwordHash,
      })
      .select('id, vendor_id, email, created_at, updated_at')
      .single();

    if (userError || !user) {
      await supabase.from('vendors').delete().eq('id', vendor.id);
      throw new Error(`Failed to create user: ${userError?.message}`);
    }

    await supabase
      .from('vendor_user_roles')
      .insert({ user_id: user.id, vendor_id: vendor.id, role: 'owner' });

    return {
      id: user.id,
      vendorId: user.vendor_id,
      email: user.email,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      vendors: [{
        vendorId: vendor.id,
        vendorName: vendor.name,
        role: 'owner',
        logoUrl: null,
      }],
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const { data, error } = await supabase
      .from('vendor_users')
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
      .from('vendor_users')
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateErr) {
      throw new Error(`Failed to update password: ${updateErr.message}`);
    }
  }

  async createPasswordReset(email: string): Promise<{ token: string }> {
    // Silently succeed even if email doesn't exist (prevents email enumeration)
    const { data: user } = await supabase
      .from('vendor_users')
      .select('id')
      .eq('email', email)
      .single();

    if (!user) {
      return { token: '' };
    }

    // Invalidate any existing unused tokens for this email
    await supabase
      .from('vendor_password_resets')
      .update({ used_at: new Date().toISOString() })
      .eq('email', email)
      .is('used_at', null);

    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    const { error } = await supabase
      .from('vendor_password_resets')
      .insert([{ email, token, expires_at: expiresAt }]);

    if (error) {
      throw new Error(`Failed to create reset token: ${error.message}`);
    }

    return { token };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { data: reset, error } = await supabase
      .from('vendor_password_resets')
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
      .from('vendor_users')
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('email', reset.email);

    if (updateErr) {
      throw new Error(`Failed to reset password: ${updateErr.message}`);
    }

    await supabase
      .from('vendor_password_resets')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);
  }

  async getUserById(userId: string): Promise<(SafeVendorUser & { vendors: Array<{ vendorId: string; vendorName: string; role: string; logoUrl: string | null }> }) | null> {
    const { data, error } = await supabase
      .from('vendor_users')
      .select('id, vendor_id, email, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error || !data) return null;

    const { data: roles } = await supabase
      .from('vendor_user_roles')
      .select(`
        vendor_id,
        role,
        vendors:vendor_id (id, name, logo_url)
      `)
      .eq('user_id', userId);

    let vendors = (roles || []).map((r: any) => ({
      vendorId: r.vendor_id,
      vendorName: r.vendors?.name || '',
      role: r.role,
      logoUrl: r.vendors?.logo_url || null,
    }));

    // Fallback: if no roles exist but user has a vendor_id, fetch vendor directly
    if (vendors.length === 0 && data.vendor_id) {
      const { data: vendor } = await supabase
        .from('vendors')
        .select('id, name, logo_url')
        .eq('id', data.vendor_id)
        .single();
      if (vendor) {
        vendors = [{
          vendorId: vendor.id,
          vendorName: vendor.name || '',
          role: 'owner',
          logoUrl: vendor.logo_url || null,
        }];
      }
    }

    return {
      id: data.id,
      vendorId: data.vendor_id,
      email: data.email,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      vendors,
    };
  }

  /**
   * Compute gates (blocking/dismissible banners) for the vendor app.
   * Checks: app version, vendor profile completeness, platform config.
   */
  async getGates(vendorId: string, appVersion?: string): Promise<Array<{
    type: string;
    title: string;
    message: string;
    dismissible: boolean;
    action?: string;
    actionUrl?: string;
    actionLabel?: string;
  }>> {
    const gates: Array<{
      type: string;
      title: string;
      message: string;
      dismissible: boolean;
      action?: string;
      actionUrl?: string;
      actionLabel?: string;
    }> = [];

    // 1. Force update — check minimum app version from platform config
    const { data: configRow } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'min_vendor_app_version')
      .single();

    if (configRow?.value && appVersion) {
      const minVersion = String(configRow.value);
      if (this.isVersionBelow(appVersion, minVersion)) {
        gates.push({
          type: 'force_update',
          title: 'Update Required',
          message: `A new version of NowNow Vendor is available. Please update to continue.`,
          dismissible: false,
          action: 'app_store',
          actionLabel: 'Update Now',
        });
        // Force update blocks everything — return immediately
        return gates;
      }
    }

    // 2. Check for platform-wide announcements
    const { data: announcementRow } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'vendor_app_gate')
      .single();

    if (announcementRow?.value && typeof announcementRow.value === 'object') {
      const gate = announcementRow.value as any;
      if (gate.enabled) {
        gates.push({
          type: gate.type || 'announcement',
          title: gate.title || 'Notice',
          message: gate.message || '',
          dismissible: gate.dismissible ?? true,
          action: gate.action,
          actionUrl: gate.actionUrl,
          actionLabel: gate.actionLabel,
        });
      }
    }

    // 3. Complete profile — check if vendor has essential info
    if (vendorId) {
      const { data: vendor } = await supabase
        .from('vendors')
        .select('name, phone, email, description, logo_url')
        .eq('id', vendorId)
        .single();

      if (vendor) {
        const missingFields: string[] = [];
        if (!vendor.description) missingFields.push('description');
        if (!vendor.logo_url) missingFields.push('logo');

        if (missingFields.length > 0) {
          gates.push({
            type: 'complete_profile',
            title: 'Complete your profile',
            message: `Add a ${missingFields.join(' and ')} to help customers find you.`,
            dismissible: true,
          });
        }
      }
    }

    return gates;
  }

  /** Compare semver strings: returns true if current < minimum */
  private isVersionBelow(current: string, minimum: string): boolean {
    const parse = (v: string) => v.split('.').map(Number);
    const c = parse(current);
    const m = parse(minimum);
    for (let i = 0; i < Math.max(c.length, m.length); i++) {
      const cv = c[i] || 0;
      const mv = m[i] || 0;
      if (cv < mv) return true;
      if (cv > mv) return false;
    }
    return false;
  }
}
