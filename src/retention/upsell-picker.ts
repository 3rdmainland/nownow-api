import { supabase } from '../lib/supabase.js';

interface UpsellCandidate {
  itemName: string;
  itemPrice: number;
  vendorId: string;
}

type UpsellBias = 'popular' | 'complementary' | 'new';

export class UpsellPicker {
  /**
   * Pick a single upsell item for a customer at an event.
   * Vendor-blind: vendor name is never included in messages.
   *
   * 1. Fetch available items at event (event_menu_items + default_menu_items)
   * 2. Exclude items the customer already ordered
   * 3. Rank by bias strategy
   * 4. Return top pick or null
   */
  async pickUpsellItem(
    eventId: string,
    customerId: string | undefined,
    bias: UpsellBias,
  ): Promise<UpsellCandidate | null> {
    try {
      // Fetch available event menu items with their default item details
      const { data: eventItems, error: menuError } = await supabase
        .from('event_menu_items')
        .select('id, vendor_id, is_available, custom_price, default_menu_item:default_menu_items(id, name, price, category_id, created_at)')
        .eq('event_id', eventId)
        .eq('is_available', true);

      if (menuError || !eventItems?.length) {
        return null;
      }

      // Flatten to candidate list
      let candidates: Array<{
        itemId: string;
        itemName: string;
        itemPrice: number;
        vendorId: string;
        categoryId?: string;
        createdAt?: string;
      }> = [];

      for (const emi of eventItems) {
        const def = emi.default_menu_item as any;
        if (!def) continue;
        candidates.push({
          itemId: def.id,
          itemName: def.name,
          itemPrice: emi.custom_price ?? def.price,
          vendorId: emi.vendor_id,
          categoryId: def.category_id,
          createdAt: def.created_at,
        });
      }

      if (!candidates.length) return null;

      // Exclude items customer already ordered at this event
      if (customerId) {
        const { data: orders } = await supabase
          .from('orders')
          .select('items')
          .eq('event_id', eventId)
          .eq('customer_id', customerId);

        if (orders?.length) {
          const orderedItemIds = new Set<string>();
          for (const order of orders) {
            const items = order.items as Array<{ id: string }>;
            for (const item of items ?? []) {
              orderedItemIds.add(item.id);
            }
          }
          candidates = candidates.filter((c) => !orderedItemIds.has(c.itemId));
        }
      }

      if (!candidates.length) return null;

      // Rank by bias
      const ranked = this.rankByBias(candidates, bias, customerId);
      const pick = ranked[0];

      return {
        itemName: pick.itemName,
        itemPrice: pick.itemPrice,
        vendorId: pick.vendorId,
      };
    } catch (err) {
      console.error('UpsellPicker.pickUpsellItem failed:', (err as Error).message);
      return null;
    }
  }

  private rankByBias(
    candidates: Array<{
      itemId: string;
      itemName: string;
      itemPrice: number;
      vendorId: string;
      categoryId?: string;
      createdAt?: string;
    }>,
    bias: UpsellBias,
    _customerId?: string,
  ) {
    switch (bias) {
      case 'popular':
        // For now, shuffle (order count ranking needs aggregate query which is expensive).
        // Future: query order_items count per item.
        return this.shuffle(candidates);

      case 'complementary':
        // Prefer items from a different category than customer's favourites.
        // Without inline preference data, shuffle as fallback.
        return this.shuffle(candidates);

      case 'new':
        // Sort by created_at DESC — newest items first
        return [...candidates].sort((a, b) => {
          if (!a.createdAt || !b.createdAt) return 0;
          return b.createdAt.localeCompare(a.createdAt);
        });

      default:
        return this.shuffle(candidates);
    }
  }

  private shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
