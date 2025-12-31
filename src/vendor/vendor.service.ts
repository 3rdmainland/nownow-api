import { Vendor, VendorMenuItem, VendorMenuGroup } from "./vendor.types";
import { supabase } from "../lib/supabase";
import { fromDbMenuItem, fromDbVendor, toDbMenuItem, toDbVendor } from "./utils";
import { redis, cache, CACHE_TTL } from "../lib/redis";

// Cache key generator for vendors
const cacheKeys = {
    allVendors: () => 'vendors:all',
    vendor: (id: string) => `vendor:${id}`,
    vendorMenu: (id: string) => `vendor:${id}:menu`,
    vendorStats: (id: string) => `vendor:${id}:stats`,
    vendorsByCategory: (category: string) => `vendors:category:${category}`,
    vendorsByCuisine: (cuisine: string) => `vendors:cuisine:${cuisine}`,
    vendorsByEvent: (eventId: string, page: number, pageSize: number) =>
        `vendors:event:${eventId}:page:${page}:size:${pageSize}`,
    vendorSearch: (term: string, eventId?: string) =>
        `vendors:search:${term}${eventId ? `:event:${eventId}` : ''}`,
    vendorsWithItemsByCategory: (categoryId: string) => `vendors:menuCategory:${categoryId}`,
} as const;

export class VendorService {
    async getAllVendors(): Promise<Vendor[]> {
        const cacheKey = cacheKeys.allVendors();

        try {
            // Try cache first
            const cached = await cache.get<Vendor[]>(cacheKey);
            if (cached) {
                console.log('Cache HIT: getAllVendors');
                return cached;
            }

            console.log('Cache MISS: getAllVendors');

            // Fetch from Supabase
            const { data, error } = await supabase
                .from('vendors')
                .select('*');

            if (error) {
                throw new Error(`Failed to fetch vendors: ${error.message}`);
            }

            const vendors = (data || []).map(dbVendor => fromDbVendor(dbVendor));

            // Cache for 5 minutes
            await cache.set(cacheKey, vendors, CACHE_TTL.VENDOR_LIST);

            return vendors;
        } catch (error) {
            console.error('Error in getAllVendors:', error);
            throw error;
        }
    }

    async getVendorById(id: string): Promise<Vendor | null> {
        const cacheKey = cacheKeys.vendor(id);

        try {
            // Try cache first
            const cached = await cache.get<Vendor>(cacheKey);
            if (cached) {
                console.log(`Cache HIT: getVendorById(${id})`);
                return cached;
            }

            console.log(`Cache MISS: getVendorById(${id})`);

            // Fetch from Supabase
            const { data, error } = await supabase
                .from('vendors')
                .select('*')
                .eq('id', id)
                .single();

            if (error) {
                throw new Error(`Failed to fetch vendor: ${error.message}`);
            }

            const vendor = data ? fromDbVendor(data) : null;

            if (vendor) {
                // Cache for 1 minute
                await cache.set(cacheKey, vendor, CACHE_TTL.VENDOR_DETAILS);
            }

            return vendor;
        } catch (error) {
            console.error('Error in getVendorById:', error);
            throw error;
        }
    }

    async createVendor(vendor: Omit<Vendor, 'id' | 'createdAt'>): Promise<Vendor> {
        const dbVendor = toDbVendor(vendor);

        const { data, error } = await supabase
            .from('vendors')
            .insert([dbVendor])
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to create vendor: ${error.message}`);
        }

        const newVendor = fromDbVendor(data);

        // Invalidate related caches
        await this.invalidateVendorCaches();

        return newVendor;
    }

    async updateVendor(id: string, vendor: Partial<Vendor>): Promise<Vendor> {
        const dbVendor = toDbVendor(vendor);

        const { data, error } = await supabase
            .from('vendors')
            .update(dbVendor)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to update vendor: ${error.message}`);
        }

        const updatedVendor = fromDbVendor(data);

        // Invalidate all caches for this vendor
        await this.invalidateVendorCaches(id);

        return updatedVendor;
    }

    async deleteVendor(id: string): Promise<void> {
        const { error } = await supabase
            .from('vendors')
            .delete()
            .eq('id', id);

        if (error) {
            throw new Error(`Failed to delete vendor: ${error.message}`);
        }

        // Invalidate all caches for this vendor
        await this.invalidateVendorCaches(id);
    }

    async toggleVendorStatus(id: string, isActive: boolean): Promise<Vendor> {
        const { data, error } = await supabase
            .from('vendors')
            .update({ isActive, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to toggle vendor status: ${error.message}`);
        }

        // Invalidate caches
        await this.invalidateVendorCaches(id);

        return data;
    }

    async pauseVendor(id: string, isPaused: boolean): Promise<Vendor> {
        const { data, error } = await supabase
            .from('vendors')
            .update({ isPaused, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to pause vendor: ${error.message}`);
        }

        // Invalidate caches
        await this.invalidateVendorCaches(id);

        return data;
    }

    async getVendorsByCategory(category: string): Promise<Vendor[]> {
        const cacheKey = cacheKeys.vendorsByCategory(category);

        try {
            // Try cache first
            const cached = await cache.get<Vendor[]>(cacheKey);
            if (cached) {
                console.log(`Cache HIT: getVendorsByCategory(${category})`);
                return cached;
            }

            console.log(`Cache MISS: getVendorsByCategory(${category})`);

            // Fetch from Supabase
            const { data, error } = await supabase
                .from('vendors')
                .select('*')
                .eq('category', category)
                .eq('isActive', true);

            if (error) {
                throw new Error(`Failed to fetch vendors by category: ${error.message}`);
            }

            const vendors = (data || []).map(fromDbVendor);

            // Cache for 5 minutes
            await cache.set(cacheKey, vendors, CACHE_TTL.VENDOR_LIST);

            return vendors;
        } catch (error) {
            console.error('Error in getVendorsByCategory:', error);
            throw error;
        }
    }

    async getVendorsByCuisine(cuisineType: string): Promise<Vendor[]> {
        const cacheKey = cacheKeys.vendorsByCuisine(cuisineType);

        try {
            // Try cache first
            const cached = await cache.get<Vendor[]>(cacheKey);
            if (cached) {
                console.log(`Cache HIT: getVendorsByCuisine(${cuisineType})`);
                return cached;
            }

            console.log(`Cache MISS: getVendorsByCuisine(${cuisineType})`);

            // Fetch from Supabase
            const { data, error } = await supabase
                .from('vendors')
                .select('*')
                .contains('cuisineType', [cuisineType])
                .eq('isActive', true);

            if (error) {
                throw new Error(`Failed to fetch vendors by cuisine: ${error.message}`);
            }

            const vendors = (data || []).map(fromDbVendor);

            // Cache for 5 minutes
            await cache.set(cacheKey, vendors, CACHE_TTL.VENDOR_LIST);

            return vendors;
        } catch (error) {
            console.error('Error in getVendorsByCuisine:', error);
            throw error;
        }
    }

    /**
     * Return active vendors that have at least one AVAILABLE menu item
     * in the specified menu category (categoryId refers to vendor_menu_items.category_id)
     */
    async getVendorsWithItemsInCategory(categoryId: string): Promise<Vendor[]> {
        const cacheKey = cacheKeys.vendorsWithItemsByCategory(categoryId);

        try {
            // Try cache first
            const cached = await cache.get<Vendor[]>(cacheKey);
            if (cached) {
                console.log(`Cache HIT: getVendorsWithItemsInCategory(${categoryId})`);
                return cached;
            }

            console.log(`Cache MISS: getVendorsWithItemsInCategory(${categoryId})`);

            // Find vendor ids that have at least one available item in category
            const { data: items, error: itemsError } = await supabase
                .from('vendor_menu_items')
                .select('vendor_id')
                .eq('category_id', categoryId)
                .eq('available', true);

            if (itemsError) {
                throw new Error(`Failed to fetch menu items for category: ${itemsError.message}`);
            }

            const vendorIds = Array.from(new Set((items || []).map((row: any) => row.vendor_id)));

            if (vendorIds.length === 0) {
                await cache.set(cacheKey, [], CACHE_TTL.VENDOR_LIST);
                return [];
            }

            // Fetch active vendors by ids
            const { data: vendorsData, error: vendorsError } = await supabase
                .from('vendors')
                .select('*')
                .in('id', vendorIds)
                .eq('is_active', true);

            if (vendorsError) {
                throw new Error(`Failed to fetch vendors for category items: ${vendorsError.message}`);
            }

            const vendors = (vendorsData || []).map(fromDbVendor);

            // Cache the result
            await cache.set(cacheKey, vendors, CACHE_TTL.VENDOR_LIST);

            return vendors;
        } catch (error) {
            console.error('Error in getVendorsWithItemsInCategory:', error);
            throw error;
        }
    }

    private async getEventByIdOrCode(eventIdOrCode: string): Promise<string | null> {
        // First try as UUID (ID)
        const { data: eventById, error: idError } = await supabase
            .from('events')
            .select('id')
            .eq('id', eventIdOrCode)
            .single();

        if (!idError && eventById) {
            return eventById.id;
        }

        // If not found by ID, try by code
        const { data: eventByCode, error: codeError } = await supabase
            .from('events')
            .select('id')
            .eq('code', eventIdOrCode)
            .single();

        if (!codeError && eventByCode) {
            return eventByCode.id;
        }

        return null;
    }

    async getVendorsByEvent(
        eventIdOrCode: string,
        opts?: { page?: number; pageSize?: number }
    ): Promise<{ eventId: string, vendors: (Vendor & { menu: VendorMenuItem[] })[]; page: number; pageSize: number; total: number; totalPages: number; }> {
        // Normalize pagination
        const page = Math.max(1, Number(opts?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(opts?.pageSize || 20)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        // Get the actual event ID (works with both ID and code)
        const eventId = await this.getEventByIdOrCode(eventIdOrCode);
        if (!eventId) {
            throw new Error('Event not found');
        }

        const cacheKey = cacheKeys.vendorsByEvent(eventId, page, pageSize);

        try {
            // Try cache first
            const cached = await cache.get<{ eventId: string, vendors: (Vendor & { menu: VendorMenuItem[] })[]; page: number; pageSize: number; total: number; totalPages: number; }>(cacheKey);
            if (cached) {
                console.log(`Cache HIT: getVendorsByEvent(${eventId}, ${page}, ${pageSize})`);
                return cached;
            }

            console.log(`Cache MISS: getVendorsByEvent(${eventId}, ${page}, ${pageSize})`);

            // Get vendor IDs from the event_vendors junction table
            const { data: eventVendors, error: junctionError } = await supabase
                .from('event_vendors')
                .select('vendor_id')
                .eq('event_id', eventId);

            if (junctionError) {
                throw new Error(`Failed to fetch event vendors: ${junctionError.message}`);
            }

            const vendorIds = (eventVendors || []).map(ev => ev.vendor_id);

            if (vendorIds.length === 0) {
                return { eventId, vendors: [], page, pageSize, total: 0, totalPages: 0 };
            }

            // Get the actual vendor data with pagination and total count
            const { data: vendorRows, error: vendorError, count } = await supabase
                .from('vendors')
                .select('*', { count: 'exact' })
                .in('id', vendorIds)
                .eq('is_active', true)
                .range(from, to);

            if (vendorError) {
                throw new Error(`Failed to fetch vendors for event: ${vendorError.message}`);
            }

            const vendors = (vendorRows || []).map(fromDbVendor);
            const pagedVendorIds = vendors.map(v => v.id);

            // Fetch all available menu items for the vendors on this page
            let menuByVendor = new Map<string, VendorMenuItem[]>();
            if (pagedVendorIds.length > 0) {
                const { data: menuRows, error: menuError } = await supabase
                    .from('vendor_menu_items')
                    .select('*')
                    .in('vendor_id', pagedVendorIds)
                    .limit(3)
                    .eq('available', true);

                if (menuError) {
                    throw new Error(`Failed to fetch vendor menus: ${menuError.message}`);
                }

                for (const row of menuRows || []) {
                    const item = fromDbMenuItem(row);
                    const list = menuByVendor.get(item.vendorId) || [];
                    list.push(item);
                    menuByVendor.set(item.vendorId, list);
                }
            }

            const vendorsWithMenu = vendors.map(v => ({ ...v, menu: menuByVendor.get(v.id) || [] }));

            const total = count || 0;
            const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

            const result = { eventId, vendors: vendorsWithMenu, page, pageSize, total, totalPages };

            // Cache for 1 minute (event vendor lists change less frequently)
            await cache.set(cacheKey, result, CACHE_TTL.VENDOR_DETAILS);

            return result;
        } catch (error) {
            console.error('Error in getVendorsByEvent:', error);
            throw error;
        }
    }

    async searchVendors(searchTerm: string, eventIdOrCode?: string): Promise<Vendor[]> {
        const cacheKey = cacheKeys.vendorSearch(searchTerm, eventIdOrCode);

        try {
            // Try cache first
            const cached = await cache.get<Vendor[]>(cacheKey);
            if (cached) {
                console.log(`Cache HIT: searchVendors(${searchTerm}, ${eventIdOrCode})`);
                return cached;
            }

            console.log(`Cache MISS: searchVendors(${searchTerm}, ${eventIdOrCode})`);

            let vendorIds: string[] | undefined = undefined;

            if (eventIdOrCode) {
                // Get the actual event ID (works with both ID and code)
                const eventId = await this.getEventByIdOrCode(eventIdOrCode);

                if (!eventId) {
                    throw new Error('Event not found');
                }

                // Get vendor IDs from junction table
                const { data: eventVendors, error: junctionError } = await supabase
                    .from('event_vendors')
                    .select('vendor_id')
                    .eq('event_id', eventId);

                if (junctionError) {
                    throw new Error(`Failed to fetch event for vendor search: ${junctionError.message}`);
                }

                vendorIds = (eventVendors || []).map(ev => ev.vendor_id);

                if (vendorIds.length === 0) {
                    return [];
                }
            }

            let query = supabase
                .from('vendors')
                .select('*')
                .eq('is_active', true);

            if (vendorIds && vendorIds.length > 0) {
                query = query.in('id', vendorIds);
            }

            const { data, error } = await query
                .or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);

            if (error) {
                throw new Error(`Failed to search vendors: ${error.message}`);
            }

            const vendors = (data || []).map(fromDbVendor);

            // Cache search results for 30 seconds (searches change frequently)
            await cache.set(cacheKey, vendors, CACHE_TTL.MENU_ITEMS);

            return vendors;
        } catch (error) {
            console.error('Error in searchVendors:', error);
            throw error;
        }
    }

    async getNearbyVendors(lat: number, lng: number, radiusKm: number = 5): Promise<Vendor[]> {
        // This is a simplified version - for production, use PostGIS or proper geospatial queries
        const { data, error } = await supabase
            .from('vendors')
            .select('*')
            .eq('isActive', true);

        if (error) {
            throw new Error(`Failed to fetch nearby vendors: ${error.message}`);
        }

        // Filter by distance (Haversine formula)
        const nearbyVendors = (data || []).filter(vendor => {
            const distance = this.calculateDistance(
                lat, lng,
                vendor.location.latitude,
                vendor.location.longitude
            );
            return distance <= radiusKm;
        });

        return nearbyVendors;
    }

    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // ==================== MENU ITEMS ====================

    async getVendorMenu(vendorId: string): Promise<VendorMenuGroup[]> {
        const cacheKey = cacheKeys.vendorMenu(vendorId);

        try {
            // Try cache first
            const cached = await cache.get<VendorMenuGroup[]>(cacheKey);
            if (cached) {
                console.log(`Cache HIT: getVendorMenu(${vendorId})`);
                return cached;
            }

            console.log(`Cache MISS: getVendorMenu(${vendorId})`);

            // Fetch from Supabase
            const { data, error } = await supabase
                .from('vendor_menu_items')
                .select('*')
                .eq('vendor_id', vendorId)
                .eq('available', true);

            if (error) {
                throw new Error(`Failed to fetch menu: ${error.message}`);
            }

            const items = (data || []).map(fromDbMenuItem);

            // Group by categoryId
            const byCategory: Record<string, VendorMenuItem[]> = {};
            for (const item of items) {
                const key = item.categoryId;
                if (!byCategory[key]) byCategory[key] = [];
                byCategory[key].push(item);
            }

            const categoryIds = Object.keys(byCategory);
            if (categoryIds.length === 0) return [];

            const { data: categories, error: catError } = await supabase
                .from('categories')
                .select('id, name')
                .in('id', categoryIds);

            if (catError) {
                throw new Error(`Failed to fetch categories for menu: ${catError.message}`);
            }

            const nameById = new Map<string, string>((categories || []).map((c: any) => [c.id, c.name]));

            const grouped: VendorMenuGroup[] = categoryIds.map((id) => ({
                category: { id, name: nameById.get(id) || '' },
                menuItems: byCategory[id]
            }));

            // Cache menu for 30 seconds (menu items change frequently)
            await cache.set(cacheKey, grouped, CACHE_TTL.MENU_ITEMS);

            return grouped;
        } catch (error) {
            console.error('Error in getVendorMenu:', error);
            throw error;
        }
    }

    async getMenuItemById(vendorId: string, itemId: string): Promise<VendorMenuItem | null> {
        try {
            const { data, error } = await supabase
                .from('vendor_menu_items')
                .select('*')
                .eq('id', itemId)
                .eq('vendor_id', vendorId)
                .single();

            if (error) {
                if (error.code === 'PGRST116' /* No rows found */) {
                    return null;
                }
                throw new Error(`Failed to fetch menu item: ${error.message}`);
            }

            return data ? fromDbMenuItem(data) : null;
        } catch (error) {
            console.error('Error in getMenuItemById:', error);
            throw error;
        }
    }

    async addMenuItem(vendorId: string, item: Omit<VendorMenuItem, 'id' | 'createdAt'>): Promise<VendorMenuItem> {
        const dbMenuItem = toDbMenuItem({ ...item, vendorId });

        const { data, error } = await supabase
            .from('vendor_menu_items')
            .insert([dbMenuItem])
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to add menu item: ${error.message}`);
        }

        const newItem = fromDbMenuItem(data);

        // Invalidate menu cache for this vendor
        await cache.del(
            cacheKeys.vendorMenu(vendorId),
            cacheKeys.vendorsWithItemsByCategory(newItem.categoryId)
        );

        return newItem;
    }

    async updateMenuItem(itemId: string, updates: Partial<VendorMenuItem>): Promise<VendorMenuItem> {
        const dbMenuItem = toDbMenuItem(updates);

        const { data, error } = await supabase
            .from('vendor_menu_items')
            .update(dbMenuItem)
            .eq('id', itemId)
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to update menu item: ${error.message}`);
        }

        const updatedItem = fromDbMenuItem(data);

        // Invalidate menu cache for this vendor and category-based vendor lists
        await cache.del(
            cacheKeys.vendorMenu(updatedItem.vendorId),
            cacheKeys.vendorsWithItemsByCategory(updatedItem.categoryId)
        );

        return updatedItem;
    }

    async deleteMenuItem(itemId: string): Promise<void> {
        // Get the item first to know which vendor/category caches to invalidate
        const { data: item, error: fetchError } = await supabase
            .from('vendor_menu_items')
            .select('vendor_id, category_id')
            .eq('id', itemId)
            .single();

        if (fetchError) {
            throw new Error(`Failed to fetch menu item for deletion: ${fetchError.message}`);
        }

        const { error } = await supabase
            .from('vendor_menu_items')
            .delete()
            .eq('id', itemId);

        if (error) {
            throw new Error(`Failed to delete menu item: ${error.message}`);
        }

        // Invalidate menu and category caches
        if (item) {
            await cache.del(
                cacheKeys.vendorMenu(item.vendor_id),
                cacheKeys.vendorsWithItemsByCategory(item.category_id)
            );
        }
    }

    async toggleMenuItemAvailability(itemId: string, available: boolean): Promise<VendorMenuItem> {
        const { data, error } = await supabase
            .from('vendor_menu_items')
            .update({ available })
            .eq('id', itemId)
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to toggle item availability: ${error.message}`);
        }

        const updatedItem = fromDbMenuItem(data);

        // Invalidate menu cache for this vendor and category-based vendor lists
        await cache.del(
            cacheKeys.vendorMenu(updatedItem.vendorId),
            cacheKeys.vendorsWithItemsByCategory(updatedItem.categoryId)
        );

        return updatedItem;
    }

    // ==================== STATS ====================

    async getVendorStats(vendorId: string): Promise<{
        totalOrders: number;
        totalRevenue: number;
        averageRating: number;
        todayOrders: number;
        activeOrders: number;
    }> {
        const cacheKey = cacheKeys.vendorStats(vendorId);

        try {
            // Try cache first (very short TTL for stats)
            const cached = await cache.get<{
                totalOrders: number;
                totalRevenue: number;
                averageRating: number;
                todayOrders: number;
                activeOrders: number;
            }>(cacheKey);

            if (cached) {
                console.log(`Cache HIT: getVendorStats(${vendorId})`);
                return cached;
            }

            console.log(`Cache MISS: getVendorStats(${vendorId})`);

            // Get orders for this vendor
            const { data: orders, error: ordersError } = await supabase
                .from('orders')
                .select('*')
                .eq('vendor_id', vendorId);

            if (ordersError) {
                throw new Error(`Failed to fetch vendor stats: ${ordersError.message}`);
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const stats = {
                totalOrders: orders?.length || 0,
                totalRevenue: orders?.reduce((sum, order) => sum + order.total, 0) || 0,
                averageRating: 0, // Would come from reviews table
                todayOrders: orders?.filter(order =>
                    new Date(order.created_at) >= today
                ).length || 0,
                activeOrders: orders?.filter(order =>
                    ['pending', 'preparing', 'ready'].includes(order.status)
                ).length || 0
            };

            // Cache stats for 5 seconds (very dynamic data)
            await cache.set(cacheKey, stats, CACHE_TTL.ACTIVE_ORDERS);

            return stats;
        } catch (error) {
            console.error('Error in getVendorStats:', error);
            throw error;
        }
    }

    // ==================== CACHE INVALIDATION ====================

    /**
     * Invalidate all caches related to a specific vendor
     * Call this after any vendor update, delete, or status change
     */
    private async invalidateVendorCaches(vendorId?: string): Promise<void> {
        const keysToDelete: string[] = [
            cacheKeys.allVendors(),
        ];

        if (vendorId) {
            keysToDelete.push(
                cacheKeys.vendor(vendorId),
                cacheKeys.vendorMenu(vendorId),
                cacheKeys.vendorStats(vendorId)
            );
        }

        try {
            await cache.del(...keysToDelete);
            console.log(`Invalidated caches for vendor: ${vendorId || 'all'}`);

            // Also clear pattern-based caches (category, cuisine, event, search)
            // Note: Upstash doesn't support SCAN, so we'd need to track these keys separately
            // For now, they'll expire naturally via TTL
        } catch (error) {
            console.error('Error invalidating vendor caches:', error);
            // Don't throw - cache invalidation failure shouldn't break the operation
        }
    }

    /**
     * Manual cache invalidation endpoint (useful for webhooks)
     */
    async invalidateCache(vendorId?: string): Promise<void> {
        await this.invalidateVendorCaches(vendorId);
    }
}
