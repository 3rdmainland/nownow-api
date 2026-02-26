import { supabase } from '../lib/supabase.js';
import { cache } from '../lib/redis.js';
import { ValidationError, NotFoundError } from '../lib/errors.js';
import {
    Discount,
    CreateDiscountInput,
    UpdateDiscountInput,
    ResolvedDiscount,
} from './discount.types.js';

// ==================== DATABASE MAPPING ====================

function toDbDiscount(input: Record<string, any>): Record<string, any> {
    const db: Record<string, any> = {};
    if (input.eventId !== undefined) db.event_id = input.eventId;
    if (input.vendorId !== undefined) db.vendor_id = input.vendorId;
    if (input.scope !== undefined) db.scope = input.scope;
    if (input.targetItemIds !== undefined) db.target_item_ids = input.targetItemIds;
    if (input.type !== undefined) db.type = input.type;
    if (input.value !== undefined) db.value = input.value;
    if (input.isActive !== undefined) db.is_active = input.isActive;
    if (input.createdBy !== undefined) db.created_by = input.createdBy;
    return db;
}

function fromDbDiscount(row: any): Discount {
    return {
        id: row.id,
        eventId: row.event_id,
        vendorId: row.vendor_id,
        scope: row.scope,
        targetItemIds: row.target_item_ids,
        type: row.type,
        value: parseFloat(row.value),
        isActive: row.is_active,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// ==================== HELPERS ====================

function calculateSavings(price: number, discount: Discount): number {
    if (discount.type === 'PERCENTAGE') {
        return price * (discount.value / 100);
    }
    // FIXED: can't save more than the price
    return Math.min(discount.value, price);
}

function discountAppliesToItem(discount: Discount, vendorId: string, itemId: string): boolean {
    // Organizer event-wide: applies to all vendors/items
    if (discount.vendorId === null && discount.scope === 'EVENT') {
        return true;
    }
    // Vendor discount: must match vendorId
    if (discount.vendorId !== vendorId) {
        return false;
    }
    // Vendor event-wide: applies to all their items
    if (discount.scope === 'EVENT') {
        return true;
    }
    // Vendor per-item: check target_item_ids
    if (discount.scope === 'ITEM' && discount.targetItemIds) {
        return discount.targetItemIds.includes(itemId);
    }
    return false;
}

// ==================== HELPERS ====================

async function invalidateEventMenuCaches(eventId: string, vendorId: string | null | undefined): Promise<void> {
    try {
        if (vendorId) {
            await cache.del(`menu:event:${vendorId}:${eventId}`);
        } else {
            // Organizer discount — invalidate caches for all vendors at this event
            const { data } = await supabase
                .from('event_menu_configurations')
                .select('vendor_id')
                .eq('event_id', eventId);
            if (data && data.length > 0) {
                await Promise.all(data.map(row => cache.del(`menu:event:${row.vendor_id}:${eventId}`)));
            }
        }
    } catch (err) {
        console.error('Failed to invalidate event menu cache after discount change:', err);
    }
}

// ==================== SERVICE ====================

export class DiscountService {

    async createDiscount(input: CreateDiscountInput): Promise<Discount> {
        // Validate scope + targetItemIds
        if (input.scope === 'ITEM' && (!input.targetItemIds || input.targetItemIds.length === 0)) {
            throw new ValidationError('targetItemIds is required for ITEM scope discounts');
        }
        if (input.scope === 'EVENT') {
            input.targetItemIds = undefined;
        }

        // Validate percentage range
        if (input.type === 'PERCENTAGE' && (input.value < 0.01 || input.value > 100)) {
            throw new ValidationError('Percentage discount must be between 0.01 and 100');
        }

        // Organizer discounts must not have vendorId
        if (input.createdBy === 'ORGANIZER' && input.vendorId) {
            throw new ValidationError('Organizer discounts cannot target a specific vendor');
        }

        // Vendor discounts must have vendorId
        if (input.createdBy === 'VENDOR' && !input.vendorId) {
            throw new ValidationError('Vendor discounts require a vendorId');
        }

        const dbData = toDbDiscount(input);
        const { data, error } = await supabase
            .from('discounts')
            .insert(dbData)
            .select()
            .single();

        if (error) throw new ValidationError(`Failed to create discount: ${error.message}`);
        const discount = fromDbDiscount(data);
        await invalidateEventMenuCaches(discount.eventId, discount.vendorId);
        return discount;
    }

    async listEventDiscounts(eventId: string, vendorId?: string): Promise<Discount[]> {
        let query = supabase
            .from('discounts')
            .select('*')
            .eq('event_id', eventId)
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (vendorId) {
            // Vendor view: their own discounts + organizer discounts
            query = query.or(`vendor_id.eq.${vendorId},vendor_id.is.null`);
        }

        const { data, error } = await query;
        if (error) throw new ValidationError(`Failed to list discounts: ${error.message}`);
        return (data || []).map(fromDbDiscount);
    }

    async listVendorDiscounts(eventId: string, vendorId: string): Promise<Discount[]> {
        const { data, error } = await supabase
            .from('discounts')
            .select('*')
            .eq('event_id', eventId)
            .eq('vendor_id', vendorId)
            .order('created_at', { ascending: false });

        if (error) throw new ValidationError(`Failed to list vendor discounts: ${error.message}`);
        return (data || []).map(fromDbDiscount);
    }

    async listOrganizerDiscounts(eventId: string): Promise<Discount[]> {
        const { data, error } = await supabase
            .from('discounts')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });

        if (error) throw new ValidationError(`Failed to list discounts: ${error.message}`);
        return (data || []).map(fromDbDiscount);
    }

    async updateDiscount(id: string, input: UpdateDiscountInput): Promise<Discount> {
        if (input.scope === 'ITEM' && input.targetItemIds !== undefined && input.targetItemIds !== null && input.targetItemIds.length === 0) {
            throw new ValidationError('targetItemIds cannot be empty for ITEM scope discounts');
        }
        if (input.type === 'PERCENTAGE' && input.value !== undefined && (input.value < 0.01 || input.value > 100)) {
            throw new ValidationError('Percentage discount must be between 0.01 and 100');
        }

        const dbData = {
            ...toDbDiscount(input),
            updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
            .from('discounts')
            .update(dbData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw new NotFoundError(`Discount not found: ${error.message}`);
        const discount = fromDbDiscount(data);
        await invalidateEventMenuCaches(discount.eventId, discount.vendorId);
        return discount;
    }

    async deleteDiscount(id: string): Promise<void> {
        const { data, error } = await supabase
            .from('discounts')
            .delete()
            .eq('id', id)
            .select()
            .single();

        if (error) throw new NotFoundError(`Discount not found: ${error.message}`);
        if (data) {
            const discount = fromDbDiscount(data);
            await invalidateEventMenuCaches(discount.eventId, discount.vendorId);
        }
    }

    /**
     * Batch-resolve discounts for all items in an event menu.
     * Single DB query, then in-memory resolution per item.
     * Returns a map of itemId -> ResolvedDiscount (or null if no discount).
     */
    async resolveDiscountsForMenu(
        eventId: string,
        vendorId: string,
        items: Array<{ itemId: string; price: number }>
    ): Promise<Map<string, ResolvedDiscount | null>> {
        const result = new Map<string, ResolvedDiscount | null>();

        // Fetch all active discounts that could apply to this vendor at this event
        const { data, error } = await supabase
            .from('discounts')
            .select('*')
            .eq('event_id', eventId)
            .eq('is_active', true)
            .or(`vendor_id.eq.${vendorId},vendor_id.is.null`);

        if (error || !data || data.length === 0) {
            // No discounts — set all items to null
            for (const item of items) {
                result.set(item.itemId, null);
            }
            return result;
        }

        const discounts = data.map(fromDbDiscount);

        for (const item of items) {
            let bestDiscount: Discount | null = null;
            let bestSavings = 0;

            for (const discount of discounts) {
                if (!discountAppliesToItem(discount, vendorId, item.itemId)) continue;

                const savings = calculateSavings(item.price, discount);
                if (savings > bestSavings) {
                    bestSavings = savings;
                    bestDiscount = discount;
                }
            }

            if (!bestDiscount || bestSavings <= 0) {
                result.set(item.itemId, null);
                continue;
            }

            const discountedPrice = Math.max(0, Math.round((item.price - bestSavings) * 100) / 100);
            const discountPercentage = item.price > 0
                ? Math.round((bestSavings / item.price) * 1000) / 10
                : 0;

            result.set(item.itemId, {
                discountId: bestDiscount.id,
                type: bestDiscount.type,
                value: bestDiscount.value,
                originalPrice: item.price,
                discountedPrice,
                discountPercentage,
                savings: Math.round(bestSavings * 100) / 100,
            });
        }

        return result;
    }

    /**
     * Resolve the best discount for a single item (used during order validation).
     */
    async resolveDiscount(
        eventId: string,
        vendorId: string,
        itemId: string,
        priceBeforeDiscount: number
    ): Promise<ResolvedDiscount | null> {
        const map = await this.resolveDiscountsForMenu(eventId, vendorId, [
            { itemId, price: priceBeforeDiscount },
        ]);
        return map.get(itemId) ?? null;
    }
}
