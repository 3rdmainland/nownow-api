import { describe, it, expect } from 'vitest';
import {
  toDbDefaultMenuItem,
  fromDbDefaultMenuItem,
  toDbEventMenuItem,
  fromDbEventMenuItem,
  toDbMenuCategory,
  fromDbMenuCategory,
  toDbModifierGroup,
  fromDbModifierGroup,
  toDbModifier,
  fromDbModifier,
  toDbTag,
  fromDbTag,
  toDbMenuTemplate,
  fromDbMenuTemplate,
  toDbEventMenuConfig,
  fromDbEventMenuConfig,
  resolveEventMenuItem,
  applyPriceAdjustment,
  validateDefaultMenuItemInput,
  validateEventMenuItemInput,
  generateSlug,
  calculateMargin,
  isItemAvailableAtTime,
  groupItemsByCategory,
  sortByDisplayOrder,
  filterByTags,
  searchMenuItems,
  getPriceRange,
  formatPrice,
} from '../../vendor/menu/vendor-menu.utils.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Tests — vendor-menu.utils.ts
// ═══════════════════════════════════════════════════════════════════════════════

describe('vendor-menu.utils', () => {
  // ── toDbDefaultMenuItem / fromDbDefaultMenuItem ─────────────────────────

  describe('toDbDefaultMenuItem', () => {
    it('converts camelCase API fields to snake_case DB fields', () => {
      const result = toDbDefaultMenuItem({
        vendorId: 'v1',
        categoryId: 'c1',
        name: 'Burger',
        basePrice: 80,
        prepTime: 10,
        isFeatured: true,
        isActive: true,
      });

      expect(result).toEqual({
        vendor_id: 'v1',
        category_id: 'c1',
        name: 'Burger',
        base_price: 80,
        prep_time: 10,
        is_featured: true,
        is_active: true,
      });
    });

    it('omits undefined fields', () => {
      const result = toDbDefaultMenuItem({ name: 'Pizza' });
      expect(result).toEqual({ name: 'Pizza' });
      expect(result).not.toHaveProperty('vendor_id');
    });

    it('returns empty object for empty input', () => {
      expect(toDbDefaultMenuItem({})).toEqual({});
    });
  });

  describe('fromDbDefaultMenuItem', () => {
    it('converts snake_case DB row to camelCase API format', () => {
      const dbRow = {
        id: 'item-1',
        vendor_id: 'v1',
        category_id: 'c1',
        sku: 'BRG-001',
        name: 'Burger',
        slug: 'burger',
        description: 'Beef burger',
        short_description: 'Burger',
        image_url: 'https://img.test/burger.jpg',
        images: ['img1.jpg'],
        type: 'FOOD',
        base_price: 80,
        cost_price: 30,
        pricing_strategy: 'FIXED',
        prep_time: 10,
        cooking_instructions: 'Grill',
        track_inventory: true,
        stock_quantity: 50,
        low_stock_threshold: 5,
        availability_status: 'AVAILABLE',
        tag_ids: ['tag1'],
        modifier_group_ids: ['mg1'],
        display_order: 2,
        is_featured: true,
        is_popular: false,
        nutritional_info: { calories: 500 },
        is_active: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-02',
      };

      const result = fromDbDefaultMenuItem(dbRow);

      expect(result.id).toBe('item-1');
      expect(result.vendorId).toBe('v1');
      expect(result.categoryId).toBe('c1');
      expect(result.basePrice).toBe(80);
      expect(result.prepTime).toBe(10);
      expect(result.isFeatured).toBe(true);
      expect(result.scope).toBe('DEFAULT');
      expect(result.tagIds).toEqual(['tag1']);
    });

    it('applies defaults for missing optional fields', () => {
      const result = fromDbDefaultMenuItem({
        id: 'x',
        vendor_id: 'v',
        name: 'Test',
        base_price: 10,
        type: 'FOOD',
      });

      expect(result.images).toEqual([]);
      expect(result.pricingStrategy).toBe('FIXED');
      expect(result.trackInventory).toBe(false);
      expect(result.availabilityStatus).toBe('AVAILABLE');
      expect(result.tagIds).toEqual([]);
      expect(result.modifierGroupIds).toEqual([]);
      expect(result.displayOrder).toBe(0);
      expect(result.isFeatured).toBe(false);
      expect(result.isPopular).toBe(false);
      expect(result.isActive).toBe(true);
    });
  });

  // ── toDbEventMenuItem / fromDbEventMenuItem ────────────────────────────

  describe('toDbEventMenuItem', () => {
    it('converts event menu item fields to DB format', () => {
      const result = toDbEventMenuItem({
        eventId: 'e1',
        vendorId: 'v1',
        defaultMenuItemId: 'item-1',
        priceOverride: 90,
        isIncluded: true,
      });

      expect(result).toEqual({
        event_id: 'e1',
        vendor_id: 'v1',
        default_menu_item_id: 'item-1',
        price_override: 90,
        is_included: true,
      });
    });
  });

  describe('fromDbEventMenuItem', () => {
    it('converts DB event menu item to API format with defaults', () => {
      const result = fromDbEventMenuItem({
        id: 'emi-1',
        event_id: 'e1',
        vendor_id: 'v1',
        default_menu_item_id: 'item-1',
        price_override: null,
        availability_override: null,
        prep_time_override: null,
        stock_quantity_override: null,
        display_order_override: null,
        max_orders_per_customer: null,
        max_total_orders: null,
      });

      expect(result.id).toBe('emi-1');
      expect(result.isIncluded).toBe(true);
      expect(result.isFeaturedAtEvent).toBe(false);
      expect(result.currentOrderCount).toBe(0);
    });
  });

  // ── toDbMenuCategory / fromDbMenuCategory ──────────────────────────────

  describe('toDbMenuCategory / fromDbMenuCategory', () => {
    it('round-trips category data correctly', () => {
      const dbData = toDbMenuCategory({
        vendorId: 'v1',
        name: 'Drinks',
        slug: 'drinks',
        displayOrder: 3,
        isActive: true,
      });

      expect(dbData.vendor_id).toBe('v1');
      expect(dbData.name).toBe('Drinks');

      const apiData = fromDbMenuCategory({
        id: 'cat-1',
        vendor_id: 'v1',
        name: 'Drinks',
        slug: 'drinks',
        display_order: 3,
        is_active: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-02',
      });

      expect(apiData.vendorId).toBe('v1');
      expect(apiData.displayOrder).toBe(3);
      expect(apiData.isActive).toBe(true);
    });
  });

  // ── toDbModifierGroup / fromDbModifierGroup ────────────────────────────

  describe('toDbModifierGroup / fromDbModifierGroup', () => {
    it('converts modifier group correctly', () => {
      const dbData = toDbModifierGroup({
        vendorId: 'v1',
        name: 'Sauces',
        selectionType: 'MULTI',
        isRequired: false,
        minSelections: 0,
        maxSelections: 3,
      });

      expect(dbData.vendor_id).toBe('v1');
      expect(dbData.selection_type).toBe('MULTI');
      expect(dbData.max_selections).toBe(3);

      const modifiers = [{ id: 'm1', groupId: 'mg1', name: 'Ketchup', priceAdjustment: 5 }];
      const apiData = fromDbModifierGroup(
        { id: 'mg1', vendor_id: 'v1', name: 'Sauces', selection_type: 'MULTI', created_at: '2024-01-01', updated_at: '2024-01-02' },
        modifiers as any,
      );

      expect(apiData.modifiers).toEqual(modifiers);
      expect(apiData.isRequired).toBe(false);
      expect(apiData.minSelections).toBe(0);
      expect(apiData.maxSelections).toBe(1); // default
    });
  });

  // ── toDbModifier / fromDbModifier ──────────────────────────────────────

  describe('toDbModifier / fromDbModifier', () => {
    it('converts modifier correctly', () => {
      const dbData = toDbModifier({
        groupId: 'mg1',
        name: 'Ketchup',
        priceAdjustment: 5,
        isDefault: true,
      });
      expect(dbData.group_id).toBe('mg1');
      expect(dbData.price_adjustment).toBe(5);

      const apiData = fromDbModifier({
        id: 'm1',
        group_id: 'mg1',
        name: 'Ketchup',
        price_adjustment: 5,
        is_default: true,
        is_available: true,
        display_order: 1,
        created_at: '2024-01-01',
        updated_at: '2024-01-02',
      });

      expect(apiData.groupId).toBe('mg1');
      expect(apiData.priceAdjustment).toBe(5);
      expect(apiData.isDefault).toBe(true);
    });

    it('applies defaults for missing modifier fields', () => {
      const result = fromDbModifier({ id: 'm1', name: 'Plain' });
      expect(result.priceAdjustment).toBe(0);
      expect(result.isDefault).toBe(false);
      expect(result.isAvailable).toBe(true);
      expect(result.displayOrder).toBe(0);
    });
  });

  // ── toDbTag / fromDbTag ────────────────────────────────────────────────

  describe('toDbTag / fromDbTag', () => {
    it('converts tag correctly', () => {
      const dbData = toDbTag({ name: 'Spicy', slug: 'spicy', color: '#FF0000' });
      expect(dbData).toEqual({ name: 'Spicy', slug: 'spicy', color: '#FF0000' });

      const apiData = fromDbTag({
        id: 't1', name: 'Spicy', slug: 'spicy', color: '#FF0000',
        is_active: true, created_at: '2024-01-01', updated_at: '2024-01-02',
      });
      expect(apiData.name).toBe('Spicy');
      expect(apiData.isActive).toBe(true);
    });
  });

  // ── toDbMenuTemplate / fromDbMenuTemplate ──────────────────────────────

  describe('toDbMenuTemplate / fromDbMenuTemplate', () => {
    it('converts template correctly', () => {
      const dbData = toDbMenuTemplate({
        vendorId: 'v1',
        name: 'Festival Menu',
        templateType: 'EVENT',
        includedCategoryIds: ['c1'],
      });
      expect(dbData.vendor_id).toBe('v1');
      expect(dbData.template_type).toBe('EVENT');
      expect(dbData.included_category_ids).toEqual(['c1']);

      const apiData = fromDbMenuTemplate({
        id: 'tmpl-1', vendor_id: 'v1', name: 'Festival Menu', template_type: 'EVENT',
        included_category_ids: ['c1'], created_at: '2024-01-01', updated_at: '2024-01-02',
      });
      expect(apiData.vendorId).toBe('v1');
      expect(apiData.includedCategoryIds).toEqual(['c1']);
      expect(apiData.excludedItemIds).toEqual([]);
      expect(apiData.isDefault).toBe(false);
      expect(apiData.usageCount).toBe(0);
    });
  });

  // ── toDbEventMenuConfig / fromDbEventMenuConfig ────────────────────────

  describe('toDbEventMenuConfig / fromDbEventMenuConfig', () => {
    it('converts event menu config correctly', () => {
      const dbData = toDbEventMenuConfig({
        eventId: 'e1',
        vendorId: 'v1',
        isAcceptingOrders: true,
        maxConcurrentOrders: 20,
        eventOpenTime: '08:00',
        eventCloseTime: '22:00',
      });
      expect(dbData.event_id).toBe('e1');
      expect(dbData.is_accepting_orders).toBe(true);
      expect(dbData.max_concurrent_orders).toBe(20);

      const apiData = fromDbEventMenuConfig({
        id: 'cfg-1', event_id: 'e1', vendor_id: 'v1',
        is_accepting_orders: true, max_concurrent_orders: 20,
        event_open_time: '08:00', event_close_time: '22:00',
        created_at: '2024-01-01', updated_at: '2024-01-02',
      });
      expect(apiData.eventId).toBe('e1');
      expect(apiData.isAcceptingOrders).toBe(true);
      expect(apiData.status).toBe('DRAFT'); // default
      expect(apiData.operatingSchedule).toEqual([]);
    });
  });

  // ── resolveEventMenuItem ───────────────────────────────────────────────

  describe('resolveEventMenuItem', () => {
    const defaultItem: any = {
      id: 'item-1', vendorId: 'v1', categoryId: 'c1', name: 'Burger',
      basePrice: 80, availabilityStatus: 'AVAILABLE', prepTime: 10,
      stockQuantity: 100, displayOrder: 1, tagIds: [], modifierGroupIds: [],
      isFeatured: false, isPopular: false, isActive: true, images: [],
    };

    it('uses default values when no overrides', () => {
      const eventItem: any = {
        id: 'emi-1', eventId: 'e1', isIncluded: true, isFeaturedAtEvent: false,
        currentOrderCount: 0, maxTotalOrders: null,
      };

      const resolved = resolveEventMenuItem(defaultItem, eventItem);

      expect(resolved.effectivePrice).toBe(80);
      expect(resolved.effectiveAvailability).toBe('AVAILABLE');
      expect(resolved.effectivePrepTime).toBe(10);
      expect(resolved.hasEventOverrides).toBe(false);
      expect(resolved.overriddenFields).toEqual([]);
    });

    it('applies event overrides and tracks overridden fields', () => {
      const eventItem: any = {
        id: 'emi-1', eventId: 'e1', isIncluded: true, isFeaturedAtEvent: true,
        priceOverride: 100, availabilityOverride: 'LIMITED', prepTimeOverride: 15,
        currentOrderCount: 5, maxTotalOrders: 50,
      };

      const resolved = resolveEventMenuItem(defaultItem, eventItem);

      expect(resolved.effectivePrice).toBe(100);
      expect(resolved.effectiveAvailability).toBe('LIMITED');
      expect(resolved.effectivePrepTime).toBe(15);
      expect(resolved.hasEventOverrides).toBe(true);
      expect(resolved.overriddenFields).toContain('price');
      expect(resolved.overriddenFields).toContain('availability');
      expect(resolved.overriddenFields).toContain('prepTime');
      expect(resolved.remainingOrders).toBe(45);
    });

    it('calculates remainingOrders as 0 when sold out', () => {
      const eventItem: any = {
        id: 'emi-1', eventId: 'e1', isIncluded: true,
        currentOrderCount: 50, maxTotalOrders: 50,
      };

      const resolved = resolveEventMenuItem(defaultItem, eventItem);
      expect(resolved.remainingOrders).toBe(0);
    });

    it('leaves remainingOrders undefined when maxTotalOrders is null', () => {
      const eventItem: any = {
        id: 'emi-1', eventId: 'e1', isIncluded: true,
        currentOrderCount: 10, maxTotalOrders: null,
      };

      const resolved = resolveEventMenuItem(defaultItem, eventItem);
      expect(resolved.remainingOrders).toBeUndefined();
    });
  });

  // ── applyPriceAdjustment ───────────────────────────────────────────────

  describe('applyPriceAdjustment', () => {
    it('applies percentage INCREASE correctly', () => {
      const result = applyPriceAdjustment(100, { type: 'PERCENTAGE', value: 10, direction: 'INCREASE' } as any);
      expect(result).toBe(110);
    });

    it('applies percentage DECREASE correctly', () => {
      const result = applyPriceAdjustment(100, { type: 'PERCENTAGE', value: 25, direction: 'DECREASE' } as any);
      expect(result).toBe(75);
    });

    it('applies fixed INCREASE correctly', () => {
      const result = applyPriceAdjustment(80, { type: 'FIXED', value: 20, direction: 'INCREASE' } as any);
      expect(result).toBe(100);
    });

    it('applies fixed DECREASE correctly', () => {
      const result = applyPriceAdjustment(80, { type: 'FIXED', value: 20, direction: 'DECREASE' } as any);
      expect(result).toBe(60);
    });

    it('clamps result to 0 for large decreases', () => {
      const result = applyPriceAdjustment(10, { type: 'FIXED', value: 50, direction: 'DECREASE' } as any);
      expect(result).toBe(0);
    });

    it('rounds to 2 decimal places', () => {
      const result = applyPriceAdjustment(33.33, { type: 'PERCENTAGE', value: 10, direction: 'INCREASE' } as any);
      expect(result).toBe(36.66);
    });
  });

  // ── validateDefaultMenuItemInput ───────────────────────────────────────

  describe('validateDefaultMenuItemInput', () => {
    const validInput: any = {
      name: 'Burger',
      categoryId: 'cat-1',
      basePrice: 80,
      type: 'FOOD',
    };

    it('returns isValid: true for valid input', () => {
      const result = validateDefaultMenuItemInput(validInput);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns warnings for missing description and imageUrl', () => {
      const result = validateDefaultMenuItemInput(validInput);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.field === 'description')).toBe(true);
      expect(result.warnings.some(w => w.field === 'imageUrl')).toBe(true);
    });

    it('returns error when name is empty', () => {
      const result = validateDefaultMenuItemInput({ ...validInput, name: '' });
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name')).toBe(true);
    });

    it('returns error when name exceeds 200 chars', () => {
      const result = validateDefaultMenuItemInput({ ...validInput, name: 'x'.repeat(201) });
      expect(result.isValid).toBe(false);
    });

    it('returns error when categoryId is missing', () => {
      const result = validateDefaultMenuItemInput({ ...validInput, categoryId: '' });
      expect(result.isValid).toBe(false);
    });

    it('returns error when basePrice is negative', () => {
      const result = validateDefaultMenuItemInput({ ...validInput, basePrice: -5 });
      expect(result.isValid).toBe(false);
    });

    it('returns error when basePrice is undefined', () => {
      const result = validateDefaultMenuItemInput({ ...validInput, basePrice: undefined });
      expect(result.isValid).toBe(false);
    });

    it('returns error when type is missing', () => {
      const result = validateDefaultMenuItemInput({ ...validInput, type: '' });
      expect(result.isValid).toBe(false);
    });

    it('returns error when description exceeds 2000 chars', () => {
      const result = validateDefaultMenuItemInput({ ...validInput, description: 'x'.repeat(2001) });
      expect(result.isValid).toBe(false);
    });

    it('returns error when prepTime is negative', () => {
      const result = validateDefaultMenuItemInput({ ...validInput, prepTime: -1 });
      expect(result.isValid).toBe(false);
    });

    it('returns error when stockQuantity is negative', () => {
      const result = validateDefaultMenuItemInput({ ...validInput, stockQuantity: -1 });
      expect(result.isValid).toBe(false);
    });

    it('warns when costPrice >= basePrice', () => {
      const result = validateDefaultMenuItemInput({ ...validInput, costPrice: 100 });
      expect(result.warnings.some(w => w.field === 'costPrice')).toBe(true);
    });
  });

  // ── validateEventMenuItemInput ─────────────────────────────────────────

  describe('validateEventMenuItemInput', () => {
    const validInput: any = {
      eventId: 'e1',
      defaultMenuItemId: 'item-1',
    };

    it('returns isValid: true for valid input', () => {
      const result = validateEventMenuItemInput(validInput);
      expect(result.isValid).toBe(true);
    });

    it('returns error when eventId is missing', () => {
      const result = validateEventMenuItemInput({ ...validInput, eventId: '' });
      expect(result.isValid).toBe(false);
    });

    it('returns error when defaultMenuItemId is missing', () => {
      const result = validateEventMenuItemInput({ ...validInput, defaultMenuItemId: '' });
      expect(result.isValid).toBe(false);
    });

    it('returns error when priceOverride is negative', () => {
      const result = validateEventMenuItemInput({ ...validInput, priceOverride: -10 });
      expect(result.isValid).toBe(false);
    });

    it('returns error when maxOrdersPerCustomer < 1', () => {
      const result = validateEventMenuItemInput({ ...validInput, maxOrdersPerCustomer: 0 });
      expect(result.isValid).toBe(false);
    });

    it('returns error when maxTotalOrders < 1', () => {
      const result = validateEventMenuItemInput({ ...validInput, maxTotalOrders: 0 });
      expect(result.isValid).toBe(false);
    });

    it('returns error when availableFrom >= availableTo', () => {
      const result = validateEventMenuItemInput({
        ...validInput,
        availableFrom: '2024-01-02T10:00:00Z',
        availableTo: '2024-01-01T10:00:00Z',
      });
      expect(result.isValid).toBe(false);
    });
  });

  // ── generateSlug ───────────────────────────────────────────────────────

  describe('generateSlug', () => {
    it('converts name to URL-friendly slug', () => {
      expect(generateSlug('Cheese Burger Deluxe')).toBe('cheese-burger-deluxe');
    });

    it('strips special characters', () => {
      expect(generateSlug('100% Beef (Large)')).toBe('100-beef-large');
    });

    it('trims leading and trailing hyphens', () => {
      expect(generateSlug('---Hello World---')).toBe('hello-world');
    });

    it('truncates to 100 characters', () => {
      const long = 'a'.repeat(200);
      expect(generateSlug(long).length).toBeLessThanOrEqual(100);
    });
  });

  // ── calculateMargin ───────────────────────────────────────────────────

  describe('calculateMargin', () => {
    it('calculates correct margin percentage', () => {
      expect(calculateMargin(100, 60)).toBe(40);
    });

    it('returns 0 when basePrice is 0', () => {
      expect(calculateMargin(0, 50)).toBe(0);
    });

    it('returns negative margin when cost > price', () => {
      expect(calculateMargin(50, 80)).toBe(-60);
    });
  });

  // ── isItemAvailableAtTime ──────────────────────────────────────────────

  describe('isItemAvailableAtTime', () => {
    it('returns true for available included item', () => {
      const item: any = {
        isIncludedInEvent: true,
        effectiveAvailability: 'AVAILABLE',
      };
      expect(isItemAvailableAtTime(item)).toBe(true);
    });

    it('returns false when not included in event', () => {
      const item: any = { isIncludedInEvent: false, effectiveAvailability: 'AVAILABLE' };
      expect(isItemAvailableAtTime(item)).toBe(false);
    });

    it('returns false when availability is not AVAILABLE', () => {
      const item: any = { isIncludedInEvent: true, effectiveAvailability: 'SOLD_OUT' };
      expect(isItemAvailableAtTime(item)).toBe(false);
    });

    it('returns false when checkTime is before availableFrom', () => {
      const item: any = {
        isIncludedInEvent: true,
        effectiveAvailability: 'AVAILABLE',
        availableFrom: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
      expect(isItemAvailableAtTime(item)).toBe(false);
    });

    it('returns false when checkTime is after availableTo', () => {
      const item: any = {
        isIncludedInEvent: true,
        effectiveAvailability: 'AVAILABLE',
        availableTo: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      };
      expect(isItemAvailableAtTime(item)).toBe(false);
    });

    it('returns false when remainingOrders is 0', () => {
      const item: any = {
        isIncludedInEvent: true,
        effectiveAvailability: 'AVAILABLE',
        remainingOrders: 0,
      };
      expect(isItemAvailableAtTime(item)).toBe(false);
    });

    it('returns true when remainingOrders > 0', () => {
      const item: any = {
        isIncludedInEvent: true,
        effectiveAvailability: 'AVAILABLE',
        remainingOrders: 5,
      };
      expect(isItemAvailableAtTime(item)).toBe(true);
    });
  });

  // ── groupItemsByCategory ───────────────────────────────────────────────

  describe('groupItemsByCategory', () => {
    it('groups items by their category', () => {
      const categories: any[] = [
        { id: 'c1', name: 'Food' },
        { id: 'c2', name: 'Drinks' },
      ];
      const items: any[] = [
        { categoryId: 'c1', name: 'Burger' },
        { categoryId: 'c1', name: 'Pizza' },
        { categoryId: 'c2', name: 'Coke' },
      ];

      const result = groupItemsByCategory(items, categories);

      expect(result.get(categories[0])).toHaveLength(2);
      expect(result.get(categories[1])).toHaveLength(1);
    });

    it('ignores items with unknown categoryId', () => {
      const categories: any[] = [{ id: 'c1', name: 'Food' }];
      const items: any[] = [{ categoryId: 'unknown', name: 'Mystery' }];

      const result = groupItemsByCategory(items, categories);
      expect(result.size).toBe(0);
    });
  });

  // ── sortByDisplayOrder ─────────────────────────────────────────────────

  describe('sortByDisplayOrder', () => {
    it('sorts items ascending by displayOrder', () => {
      const items = [
        { displayOrder: 3, name: 'C' },
        { displayOrder: 1, name: 'A' },
        { displayOrder: 2, name: 'B' },
      ];
      const sorted = sortByDisplayOrder(items);
      expect(sorted.map(i => i.name)).toEqual(['A', 'B', 'C']);
    });

    it('does not mutate the original array', () => {
      const items = [{ displayOrder: 2 }, { displayOrder: 1 }];
      const sorted = sortByDisplayOrder(items);
      expect(items[0].displayOrder).toBe(2);
      expect(sorted[0].displayOrder).toBe(1);
    });
  });

  // ── filterByTags ───────────────────────────────────────────────────────

  describe('filterByTags', () => {
    const items: any[] = [
      { tagIds: ['spicy', 'popular'], name: 'Hot Wings' },
      { tagIds: ['vegan'], name: 'Salad' },
      { tagIds: ['spicy', 'vegan'], name: 'Spicy Tofu' },
    ];

    it('returns all items when tagIds is empty', () => {
      expect(filterByTags(items, [])).toHaveLength(3);
    });

    it('filters by any matching tag (matchAll=false)', () => {
      const result = filterByTags(items, ['spicy']);
      expect(result).toHaveLength(2);
    });

    it('filters by all matching tags (matchAll=true)', () => {
      const result = filterByTags(items, ['spicy', 'vegan'], true);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Spicy Tofu');
    });
  });

  // ── searchMenuItems ────────────────────────────────────────────────────

  describe('searchMenuItems', () => {
    const items: any[] = [
      { name: 'Cheese Burger', description: 'Beef patty with cheese' },
      { name: 'Veggie Wrap', description: 'Fresh vegetables' },
      { name: 'Fries', description: 'Golden crispy fries' },
    ];

    it('matches by name (case-insensitive)', () => {
      const result = searchMenuItems(items, 'burger');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Cheese Burger');
    });

    it('matches by description', () => {
      const result = searchMenuItems(items, 'crispy');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Fries');
    });

    it('returns all items for empty search term', () => {
      expect(searchMenuItems(items, '')).toHaveLength(3);
      expect(searchMenuItems(items, '  ')).toHaveLength(3);
    });

    it('returns empty array when nothing matches', () => {
      expect(searchMenuItems(items, 'sushi')).toHaveLength(0);
    });
  });

  // ── getPriceRange ──────────────────────────────────────────────────────

  describe('getPriceRange', () => {
    it('returns min and max prices', () => {
      const result = getPriceRange([{ basePrice: 50 }, { basePrice: 120 }, { basePrice: 80 }]);
      expect(result).toEqual({ min: 50, max: 120 });
    });

    it('returns null for empty array', () => {
      expect(getPriceRange([])).toBeNull();
    });

    it('returns same min/max for single item', () => {
      expect(getPriceRange([{ basePrice: 42 }])).toEqual({ min: 42, max: 42 });
    });
  });

  // ── formatPrice ────────────────────────────────────────────────────────

  describe('formatPrice', () => {
    it('formats price in ZAR by default', () => {
      const result = formatPrice(80);
      expect(result).toContain('80');
      // ZAR format varies by env, just verify it's a currency string
      expect(result).toMatch(/R|ZAR/);
    });

    it('formats with custom currency', () => {
      const result = formatPrice(100, 'USD');
      expect(result).toContain('100');
    });
  });
});
