import { supabase } from '../lib/supabase.js';
import type { FavoriteItem } from './retention.types.js';

interface OrderForPreference {
  id: string;
  total: number;
  items: Array<{ id: string; name: string; category_id?: string; quantity: number }>;
}

export class PreferenceService {
  /**
   * Update customer preferences after an order is collected.
   * Upserts into customer_preferences: increments counts, recalculates averages,
   * and maintains top-10 favourite items.
   */
  async updateFromOrder(
    customerId: string,
    phone: string,
    order: OrderForPreference,
  ): Promise<void> {
    try {
      // Fetch existing preferences
      const { data: existing } = await supabase
        .from('customer_preferences')
        .select('*')
        .eq('customer_id', customerId)
        .maybeSingle();

      const now = new Date().toISOString();

      if (!existing) {
        // First order — create preferences
        const favoriteItems: FavoriteItem[] = order.items.map((item) => ({
          item_id: item.id,
          item_name: item.name,
          category_id: item.category_id,
          order_count: item.quantity,
        }));

        await supabase.from('customer_preferences').insert({
          customer_id: customerId,
          phone,
          order_count: 1,
          total_spent: order.total,
          avg_order_value: order.total,
          favorite_items: favoriteItems,
          last_order_at: now,
          created_at: now,
          updated_at: now,
        });
        return;
      }

      // Update existing preferences
      const newOrderCount = (existing.order_count ?? 0) + 1;
      const newTotalSpent = (existing.total_spent ?? 0) + order.total;
      const newAvg = newTotalSpent / newOrderCount;

      // Merge favourite items
      const favorites: FavoriteItem[] = [...(existing.favorite_items ?? [])];
      for (const item of order.items) {
        const idx = favorites.findIndex((f) => f.item_id === item.id);
        if (idx >= 0) {
          favorites[idx].order_count += item.quantity;
        } else {
          favorites.push({
            item_id: item.id,
            item_name: item.name,
            category_id: item.category_id,
            order_count: item.quantity,
          });
        }
      }

      // Keep top 10 by order_count
      favorites.sort((a, b) => b.order_count - a.order_count);
      const top10 = favorites.slice(0, 10);

      await supabase
        .from('customer_preferences')
        .update({
          phone,
          order_count: newOrderCount,
          total_spent: newTotalSpent,
          avg_order_value: Math.round(newAvg * 100) / 100,
          favorite_items: top10,
          last_order_at: now,
          updated_at: now,
        })
        .eq('customer_id', customerId);
    } catch (err) {
      console.error('PreferenceService.updateFromOrder failed:', (err as Error).message);
    }
  }
}
