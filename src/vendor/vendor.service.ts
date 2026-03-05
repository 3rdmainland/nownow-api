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
    vendorsWithItemsByCategory: (categoryId: string, eventId?: string) =>
        `vendors:menuCategory:${categoryId}${eventId ? `:event:${eventId}` : ''}`,
} as const;

export class VendorService {
    async getAllVendors(): Promise<Vendor[]> {
        const cacheKey = cacheKeys.allVendors();

        try {
            // Try cache first
            const cached = await cache.get<Vendor[]>(cacheKey);
            if (cached) {

                return cached;
            }


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
                return cached;
            }


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
                return cached;
            }


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
                return cached;
            }


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
     * in the specified menu category, optionally scoped to an event.
     */
    async getVendorsWithItemsInCategory(categoryId: string, eventIdOrCode?: string): Promise<Vendor[]> {
        // Resolve event ID when scoping to an event
        let eventId: string | undefined;
        let allowedVendorIds: string[] | undefined;

        if (eventIdOrCode) {
            const resolved = await this.getEventByIdOrCode(eventIdOrCode);
            if (resolved) {
                eventId = resolved;
                const { data: eventVendors } = await supabase
                    .from('event_vendors')
                    .select('vendor_id')
                    .eq('event_id', eventId);
                allowedVendorIds = (eventVendors || []).map((ev: any) => ev.vendor_id);
                if (allowedVendorIds.length === 0) {
                    return [];
                }

                // Filter out vendors not currently accepting orders
                allowedVendorIds = await this.filterAvailableVendors(allowedVendorIds, eventId);
                if (allowedVendorIds.length === 0) {
                    return [];
                }
            }
        }

        const cacheKey = cacheKeys.vendorsWithItemsByCategory(categoryId, eventId);

        try {
            const cached = await cache.get<Vendor[]>(cacheKey);
            if (cached) {
                return cached;
            }


            // Find vendor IDs with at least one available item in the category
            let itemQuery = supabase
                .from('vendor_menu_items')
                .select('vendor_id')
                .eq('category_id', categoryId)
                .eq('available', true);

            if (allowedVendorIds) {
                itemQuery = itemQuery.in('vendor_id', allowedVendorIds);
            }

            const { data: items, error: itemsError } = await itemQuery;

            if (itemsError) {
                throw new Error(`Failed to fetch menu items for category: ${itemsError.message}`);
            }

            const vendorIds = Array.from(new Set((items || []).map((row: any) => row.vendor_id)));

            if (vendorIds.length === 0) {
                await cache.set(cacheKey, [], CACHE_TTL.VENDOR_LIST);
                return [];
            }

            const { data: vendorsData, error: vendorsError } = await supabase
                .from('vendors')
                .select('*')
                .in('id', vendorIds)
                .eq('is_active', true)
                .eq('is_paused', false);

            if (vendorsError) {
                throw new Error(`Failed to fetch vendors for category items: ${vendorsError.message}`);
            }

            const vendors = (vendorsData || []).map(fromDbVendor);

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
    ): Promise<{ id: string, vendors: (Vendor & { menu: VendorMenuItem[] })[]; page: number; pageSize: number; total: number; totalPages: number; }> {
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
            const cached = await cache.get<{ id: string, vendors: (Vendor & { menu: VendorMenuItem[] })[]; page: number; pageSize: number; total: number; totalPages: number; }>(cacheKey);
            if (cached) {
                return cached;
            }


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
                return { id: eventId, vendors: [], page, pageSize, total: 0, totalPages: 0 };
            }

            // Filter out vendors not currently accepting orders
            const availableVendorIds = await this.filterAvailableVendors(vendorIds, eventId);

            if (availableVendorIds.length === 0) {
                return { id: eventId, vendors: [], page, pageSize, total: 0, totalPages: 0 };
            }

            // Get the actual vendor data with pagination and total count
            const { data: vendorRows, error: vendorError, count } = await supabase
                .from('vendors')
                .select('*', { count: 'exact' })
                .in('id', availableVendorIds)
                .eq('is_active', true)
                .eq('is_paused', false)
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

            const result = { id: eventId, vendors: vendorsWithMenu, page, pageSize, total, totalPages };

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
                return cached;
            }


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
        // Round coordinates to ~100m precision for cache key
        const rlat = Math.round(lat * 1000) / 1000;
        const rlng = Math.round(lng * 1000) / 1000;
        const cacheKey = `vendors:nearby:${rlat}:${rlng}:${radiusKm}`;

        const cached = await cache.get<Vendor[]>(cacheKey);
        if (cached) return cached;

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

        await cache.set(cacheKey, nearbyVendors, CACHE_TTL.MENU_ITEMS); // 5-minute TTL
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
                return cached;
            }


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
                return cached;
            }

            // 3 parallel targeted queries instead of fetching all orders
            const todayISO = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

            const [revenueResult, todayResult, activeResult] = await Promise.all([
                supabase
                    .from('orders')
                    .select('total, status')
                    .eq('vendor_id', vendorId),
                supabase
                    .from('orders')
                    .select('id', { count: 'exact', head: true })
                    .eq('vendor_id', vendorId)
                    .gte('created_at', todayISO),
                supabase
                    .from('orders')
                    .select('id', { count: 'exact', head: true })
                    .eq('vendor_id', vendorId)
                    .in('status', ['PENDING', 'PREPARING', 'READY']),
            ]);

            if (revenueResult.error) {
                throw new Error(`Failed to fetch vendor stats: ${revenueResult.error.message}`);
            }

            const orders = revenueResult.data || [];

            const stats = {
                totalOrders: orders.length,
                totalRevenue: orders.reduce((sum, order) => sum + order.total, 0),
                averageRating: 0, // Would come from reviews table
                todayOrders: todayResult.count || 0,
                activeOrders: activeResult.count || 0,
            };

            // Cache stats for 5 seconds (very dynamic data)
            await cache.set(cacheKey, stats, CACHE_TTL.ACTIVE_ORDERS);

            return stats;
        } catch (error) {
            console.error('Error in getVendorStats:', error);
            throw error;
        }
    }

    // ==================== AVAILABILITY FILTERING ====================

    private async filterAvailableVendors(vendorIds: string[], eventId: string): Promise<string[]> {
        const { data: configs } = await supabase
            .from('event_menu_configurations')
            .select('vendor_id, is_accepting_orders, status, event_open_time, event_close_time, operating_schedule')
            .eq('event_id', eventId)
            .in('vendor_id', vendorIds);

        if (!configs || configs.length === 0) return vendorIds;

        const unavailable = new Set<string>();
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const currentHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const todayDate = now.toISOString().split('T')[0];

        for (const config of configs) {
            if (!config.is_accepting_orders) {
                unavailable.add(config.vendor_id);
                continue;
            }
            if (config.status === 'PAUSED' || config.status === 'CLOSED') {
                unavailable.add(config.vendor_id);
                continue;
            }
            const schedule = config.operating_schedule as any[] | null;
            const todaySchedule = schedule?.find((s: any) => s.date === todayDate);
            if (todaySchedule) {
                if (todaySchedule.isClosed) {
                    unavailable.add(config.vendor_id);
                    continue;
                }
                if (todaySchedule.openTime && todaySchedule.closeTime) {
                    if (currentHHMM < todaySchedule.openTime || currentHHMM >= todaySchedule.closeTime) {
                        unavailable.add(config.vendor_id);
                        continue;
                    }
                }
            } else if (config.event_open_time && config.event_close_time) {
                if (currentHHMM < config.event_open_time || currentHHMM >= config.event_close_time) {
                    unavailable.add(config.vendor_id);
                    continue;
                }
            }
        }

        return vendorIds.filter(id => !unavailable.has(id));
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
