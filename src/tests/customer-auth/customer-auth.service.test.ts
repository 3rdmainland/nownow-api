import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({ supabase: supabaseMock, safeQuery: (fn: any) => fn(), CircuitOpenError: class CircuitOpenError extends Error {} }));

import { CustomerAuthService } from '../../customer-auth/customer-auth.service.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFromSequence(
  responses: Array<ReturnType<typeof createSupabaseMock>>,
) {
  let callIndex = 0;
  supabaseMock.from.mockImplementation(() => {
    const mock = responses[callIndex] ?? createSupabaseMock({ data: null, error: null });
    callIndex++;
    return mock;
  });
}

const makeCustomer = (overrides: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  phone: '27821234567',
  name: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  last_login_at: null,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CustomerAuthService', () => {
  let service: CustomerAuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CustomerAuthService();
  });

  // ── findOrCreateByPhone ─────────────────────────────────────────────────────

  describe('findOrCreateByPhone', () => {
    it('returns existing customer and updates last_login_at', async () => {
      const existing = makeCustomer({ phone: '27821234567' });

      mockFromSequence([
        createSupabaseMock({ data: existing, error: null }), // find
        createSupabaseMock({ data: null, error: null }),      // update last_login_at
      ]);

      const result = await service.findOrCreateByPhone('27821234567');

      expect(result.id).toBe(existing.id);
      expect(result.phone).toBe('27821234567');
      expect(result.lastLoginAt).toBeDefined();
    });

    it('creates a new customer when phone does not exist', async () => {
      const newCustomer = makeCustomer({ phone: '27829876543' });

      mockFromSequence([
        createSupabaseMock({ data: null, error: { message: 'No rows' } }), // find (not found)
        createSupabaseMock({ data: newCustomer, error: null }),             // insert
      ]);

      const result = await service.findOrCreateByPhone('27829876543');

      expect(result.id).toBe(newCustomer.id);
      expect(result.phone).toBe('27829876543');
    });

    it('throws when insert fails', async () => {
      mockFromSequence([
        createSupabaseMock({ data: null, error: { message: 'No rows' } }), // find (not found)
        createSupabaseMock({ data: null, error: { message: 'Insert failed' } }), // insert fails
      ]);

      await expect(service.findOrCreateByPhone('27821111111')).rejects.toThrow(
        'Failed to create customer'
      );
    });
  });

  // ── getCustomerById ─────────────────────────────────────────────────────────

  describe('getCustomerById', () => {
    it('returns customer for valid ID', async () => {
      const customer = makeCustomer();

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: customer, error: null }),
      );

      const result = await service.getCustomerById(customer.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(customer.id);
      expect(result!.phone).toBe(customer.phone);
    });

    it('returns null when customer is not found', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      const result = await service.getCustomerById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  // ── updateProfile ───────────────────────────────────────────────────────────

  describe('updateProfile', () => {
    it('updates customer name and returns updated customer', async () => {
      const updated = makeCustomer({ name: 'John Doe' });

      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: updated, error: null }),
      );

      const result = await service.updateProfile(updated.id, { name: 'John Doe' });

      expect(result.name).toBe('John Doe');
    });

    it('throws NotFoundError when customer does not exist', async () => {
      supabaseMock.from.mockReturnValue(
        createSupabaseMock({ data: null, error: { message: 'No rows' } }),
      );

      await expect(service.updateProfile('bad-id', { name: 'Test' })).rejects.toThrow(
        'Customer not found'
      );
    });
  });
});
