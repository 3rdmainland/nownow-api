import { supabase } from '../lib/supabase.js';
import { NotFoundError } from '../lib/errors.js';
import type { Customer, UpdateProfilePayload } from './customer-auth.types.js';

export class CustomerAuthService {
  /**
   * Find existing customer by phone, or create a new one.
   * Used after OTP verification.
   */
  async findOrCreateByPhone(phone: string, name?: string): Promise<Customer & { isNewCustomer: boolean }> {
    // Try to find existing customer
    const { data: existing, error: findErr } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existing && !findErr) {
      // Update last login
      await supabase
        .from('customers')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', existing.id);

      return {
        id: existing.id,
        phone: existing.phone,
        name: existing.name,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
        lastLoginAt: new Date().toISOString(),
        isNewCustomer: false,
      };
    }

    // Sanitize name: strip HTML tags and trim
    const sanitizedName = name?.replace(/<[^>]*>/g, '').trim() || null;

    // Create new customer
    const { data: created, error: createErr } = await supabase
      .from('customers')
      .insert([{ phone, ...(sanitizedName ? { name: sanitizedName } : {}) }])
      .select('*')
      .single();

    if (createErr || !created) {
      throw new Error(`Failed to create customer: ${createErr?.message}`);
    }

    return {
      id: created.id,
      phone: created.phone,
      name: created.name,
      createdAt: created.created_at,
      updatedAt: created.updated_at,
      lastLoginAt: created.last_login_at,
      isNewCustomer: true,
    };
  }

  /**
   * Get customer by ID.
   */
  async getCustomerById(customerId: string): Promise<Customer | null> {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      phone: data.phone,
      name: data.name,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      lastLoginAt: data.last_login_at,
    };
  }

  /**
   * Update customer profile (name).
   */
  async updateProfile(customerId: string, payload: UpdateProfilePayload): Promise<Customer> {
    const { data, error } = await supabase
      .from('customers')
      .update({
        name: payload.name,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId)
      .select('*')
      .single();

    if (error || !data) {
      throw new NotFoundError('Customer not found');
    }

    return {
      id: data.id,
      phone: data.phone,
      name: data.name,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      lastLoginAt: data.last_login_at,
    };
  }
}
