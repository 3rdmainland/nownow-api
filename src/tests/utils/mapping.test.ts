import { describe, it, expect } from 'vitest';

// Pure functions - no mocks needed
import { toDbVendor, fromDbVendor, toDbMenuItem, fromDbMenuItem } from '../../vendor/utils.js';
import { toDbEvent, fromDbEvent } from '../../event/util.js';
import { toDbCategory, fromDbCategory } from '../../category/utils.js';

// ── Vendor Utils ──────────────────────────────────────────────────────────────

describe('Vendor Utils', () => {

  describe('toDbVendor', () => {
    it('should map camelCase vendor fields to snake_case', () => {
      const vendor = {
        name: 'Test Vendor',
        description: 'A test vendor',
        phone: '0812345678',
        email: 'vendor@test.com',
        imageUrl: 'https://img.test/pic.jpg',
        logoUrl: 'https://img.test/logo.png',
        categoryId: 'cat-1',
        cuisineType: ['Fast Food'],
        rating: 4.5,
        totalReviews: 10,
        location: { latitude: -33.9, longitude: 18.4 },
        hours: [{ dayOfWeek: 1, openTime: '08:00', closeTime: '22:00' }],
        isActive: true,
        isPaused: false,
        minimumOrder: 50,
        deliveryFee: 15,
        serviceFeePercent: 5,
        estimatedPrepTime: 15,
        paymentMethods: ['CASH', 'CARD'],
      };

      const result = toDbVendor(vendor);

      expect(result).toEqual({
        name: 'Test Vendor',
        description: 'A test vendor',
        phone: '0812345678',
        email: 'vendor@test.com',
        image_url: 'https://img.test/pic.jpg',
        logo_url: 'https://img.test/logo.png',
        category_id: 'cat-1',
        cuisine_type: ['Fast Food'],
        rating: 4.5,
        total_reviews: 10,
        location: { latitude: -33.9, longitude: 18.4 },
        hours: [{ dayOfWeek: 1, openTime: '08:00', closeTime: '22:00' }],
        is_active: true,
        is_paused: false,
        minimum_order: 50,
        delivery_fee: 15,
        service_fee_percent: 5,
        estimated_prep_time: 15,
        payment_methods: ['CASH', 'CARD'],
      });
    });

    it('should only include defined fields (partial update)', () => {
      const result = toDbVendor({ name: 'Updated Name' });

      expect(result).toEqual({ name: 'Updated Name' });
      expect(result).not.toHaveProperty('description');
      expect(result).not.toHaveProperty('phone');
    });

    it('should handle empty object', () => {
      const result = toDbVendor({});

      expect(result).toEqual({});
    });

    it('should include fields with falsy values (false, 0, empty string)', () => {
      const result = toDbVendor({
        isActive: false,
        minimumOrder: 0,
        description: '',
      });

      expect(result.is_active).toBe(false);
      expect(result.minimum_order).toBe(0);
      expect(result.description).toBe('');
    });
  });

  describe('fromDbVendor', () => {
    it('should map snake_case DB row to camelCase vendor', () => {
      const dbVendor = {
        id: 'vendor-1',
        name: 'DB Vendor',
        description: 'From DB',
        phone: '0812345678',
        email: 'db@test.com',
        image_url: 'https://img.test/pic.jpg',
        logo_url: 'https://img.test/logo.png',
        category_id: 'cat-1',
        cuisine_type: ['Fast Food'],
        rating: 4.5,
        total_reviews: 10,
        location: { latitude: -33.9, longitude: 18.4 },
        hours: null,
        is_active: true,
        is_paused: false,
        minimum_order: 50,
        delivery_fee: 15,
        service_fee_percent: 5,
        estimated_prep_time: 15,
        payment_methods: ['CASH'],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      };

      const result = fromDbVendor(dbVendor);

      expect(result).toEqual({
        id: 'vendor-1',
        name: 'DB Vendor',
        description: 'From DB',
        phone: '0812345678',
        email: 'db@test.com',
        imageUrl: 'https://img.test/pic.jpg',
        logoUrl: 'https://img.test/logo.png',
        categoryId: 'cat-1',
        cuisineType: ['Fast Food'],
        rating: 4.5,
        totalReviews: 10,
        location: { latitude: -33.9, longitude: 18.4 },
        hours: null,
        isActive: true,
        isPaused: false,
        minimumOrder: 50,
        deliveryFee: 15,
        serviceFeePercent: 5,
        estimatedPrepTime: 15,
        paymentMethods: ['CASH'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      });
    });

    it('should handle null/undefined optional fields', () => {
      const dbVendor = {
        id: 'v-1',
        name: 'Minimal',
        image_url: null,
        logo_url: null,
        category_id: null,
        hours: undefined,
        delivery_fee: undefined,
      };

      const result = fromDbVendor(dbVendor);

      expect(result.imageUrl).toBeNull();
      expect(result.logoUrl).toBeNull();
      expect(result.categoryId).toBeNull();
      expect(result.hours).toBeUndefined();
      expect(result.deliveryFee).toBeUndefined();
    });
  });

  describe('toDbMenuItem', () => {
    it('should map camelCase menu item to snake_case', () => {
      const item = {
        vendorId: 'vendor-1',
        categoryId: 'cat-1',
        name: 'Burger',
        description: 'Juicy beef',
        price: 80,
        imageUrl: 'https://img.test/burger.jpg',
        type: 'FOOD',
        prepTime: 10,
        available: true,
      };

      const result = toDbMenuItem(item);

      expect(result).toEqual({
        vendor_id: 'vendor-1',
        category_id: 'cat-1',
        name: 'Burger',
        description: 'Juicy beef',
        price: 80,
        image_url: 'https://img.test/burger.jpg',
        type: 'FOOD',
        prep_time: 10,
        available: true,
      });
    });

    it('should only include defined fields (partial update)', () => {
      const result = toDbMenuItem({ name: 'Updated', price: 90 });

      expect(result).toEqual({ name: 'Updated', price: 90 });
    });

    it('should handle available=false', () => {
      const result = toDbMenuItem({ available: false });

      expect(result.available).toBe(false);
    });
  });

  describe('fromDbMenuItem', () => {
    it('should map snake_case DB row to camelCase menu item', () => {
      const dbItem = {
        id: 'item-1',
        vendor_id: 'vendor-1',
        category_id: 'cat-1',
        name: 'Burger',
        description: 'Juicy beef',
        price: 80,
        image_url: 'https://img.test/burger.jpg',
        type: 'FOOD',
        prep_time: 10,
        available: true,
        tags: ['popular', 'spicy'],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      };

      const result = fromDbMenuItem(dbItem);

      expect(result).toEqual({
        id: 'item-1',
        vendorId: 'vendor-1',
        categoryId: 'cat-1',
        name: 'Burger',
        description: 'Juicy beef',
        price: 80,
        imageUrl: 'https://img.test/burger.jpg',
        type: 'FOOD',
        prepTime: 10,
        available: true,
        tags: ['popular', 'spicy'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      });
    });

    it('should default tags to empty array when not present', () => {
      const dbItem = {
        id: 'item-1',
        vendor_id: 'vendor-1',
        category_id: 'cat-1',
        name: 'Burger',
        tags: undefined,
      };

      const result = fromDbMenuItem(dbItem);

      expect(result.tags).toEqual([]);
    });

    it('should default tags to empty array when null', () => {
      const dbItem = {
        id: 'item-1',
        vendor_id: 'vendor-1',
        category_id: 'cat-1',
        name: 'Burger',
        tags: null,
      };

      const result = fromDbMenuItem(dbItem);

      expect(result.tags).toEqual([]);
    });
  });
});

// ── Event Utils ───────────────────────────────────────────────────────────────

describe('Event Utils', () => {

  describe('toDbEvent', () => {
    it('should map camelCase event to snake_case', () => {
      const event = {
        name: 'Test Event',
        description: 'A test event',
        startDate: '2026-06-01T10:00:00Z',
        endDate: '2026-06-01T22:00:00Z',
        location: { latitude: -33.9, longitude: 18.4, address: '123 Main St', city: 'CT', state: 'WC', zipCode: '8001' },
        imageUrl: 'https://img.test/event.jpg',
        isPublic: true,
        code: 'TESTEVENT',
        status: 'PENDING',
      };

      const result = toDbEvent(event);

      expect(result).toEqual({
        name: 'Test Event',
        description: 'A test event',
        start_date: '2026-06-01T10:00:00Z',
        end_date: '2026-06-01T22:00:00Z',
        location: { latitude: -33.9, longitude: 18.4, address: '123 Main St', city: 'CT', state: 'WC', zipCode: '8001' },
        image_url: 'https://img.test/event.jpg',
        is_public: true,
        code: 'TESTEVENT',
        status: 'PENDING',
        branding: undefined,
      });
    });

    it('should include branding when provided', () => {
      const event = {
        name: 'Branded Event',
        branding: { theme: { primary: '#FF0000' } },
      };

      const result = toDbEvent(event);

      expect(result.branding).toEqual({ theme: { primary: '#FF0000' } });
    });

    it('should set branding to undefined when null', () => {
      const event = {
        name: 'No Brand',
        branding: null,
      };

      const result = toDbEvent(event);

      expect(result.branding).toBeUndefined();
    });
  });

  describe('fromDbEvent', () => {
    it('should map snake_case DB event to camelCase', () => {
      const dbEvent = {
        id: 'event-1',
        name: 'DB Event',
        description: 'From database',
        start_date: '2026-06-01T10:00:00Z',
        end_date: '2026-06-01T22:00:00Z',
        location: { latitude: -33.9, longitude: 18.4 },
        image_url: 'https://img.test/event.jpg',
        is_public: true,
        status: 'ONGOING',
        code: 'DBEV',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        branding: { theme: { primary: '#000' } },
      };

      const result = fromDbEvent(dbEvent);

      expect(result).toEqual({
        id: 'event-1',
        name: 'DB Event',
        description: 'From database',
        startDate: '2026-06-01T10:00:00Z',
        endDate: '2026-06-01T22:00:00Z',
        location: { latitude: -33.9, longitude: 18.4 },
        imageUrl: 'https://img.test/event.jpg',
        isPublic: true,
        status: 'ONGOING',
        code: 'DBEV',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        vendorIds: [],
        branding: { theme: { primary: '#000' } },
      });
    });

    it('should always initialize vendorIds as empty array', () => {
      const result = fromDbEvent({ id: 'e-1', name: 'No Vendors' });

      expect(result.vendorIds).toEqual([]);
    });

    it('should set branding to undefined when null in DB', () => {
      const result = fromDbEvent({ id: 'e-1', name: 'No Brand', branding: null });

      expect(result.branding).toBeUndefined();
    });

    it('should set branding to undefined when not present in DB', () => {
      const result = fromDbEvent({ id: 'e-1', name: 'No Brand' });

      expect(result.branding).toBeUndefined();
    });
  });
});

// ── Category Utils ────────────────────────────────────────────────────────────

describe('Category Utils', () => {

  describe('toDbCategory', () => {
    it('should map category to DB format', () => {
      const category = {
        name: 'Fast Food',
        description: 'Quick service food',
        type: 'VENDOR',
      };

      const result = toDbCategory(category);

      expect(result).toEqual({
        name: 'Fast Food',
        description: 'Quick service food',
        type: 'VENDOR',
      });
    });

    it('should handle partial category', () => {
      const result = toDbCategory({ name: 'Updated' });

      expect(result.name).toBe('Updated');
      expect(result.description).toBeUndefined();
    });
  });

  describe('fromDbCategory', () => {
    it('should map DB row to category', () => {
      const dbCategory = {
        id: 'cat-1',
        name: 'Fast Food',
        description: 'Quick service',
        type: 'VENDOR',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      };

      const result = fromDbCategory(dbCategory);

      expect(result).toEqual({
        id: 'cat-1',
        name: 'Fast Food',
        description: 'Quick service',
        type: 'VENDOR',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      });
    });
  });
});
