import { Vendor } from "./vendor.types";
import { supabase, safeQuery, CircuitOpenError } from "../lib/supabase";
import { fromDbVendor, toDbVendor } from "./utils";
import { EventService } from "../event/event.service";

import { redis, cache, CACHE_TTL } from "../lib/redis";

const eventService = new EventService();

// Cache key generator for vendors
const cacheKeys = {
    allVendors: () => 'vendors:all',
    vendor: (id: string) => `vendor:${id}`,
    // vendorMenu key removed — menu caching handled by vendor-menu module
    vendorStats: (id: string) => `vendor:${id}:stats`,
    vendorsByCategory: (category: string) => `vendors:category:${category}`,
    vendorsByCuisine: (cuisine: string) => `vendors:cuisine:${cuisine}`,
    vendorsByEvent: (eventId: string, page: number, pageSize: number, categoryId?: string, menuCategorySlug?: string) =>
        `vendors:event:${eventId}:page:${page}:size:${pageSize}${categoryId ? `:cat:${categoryId}` : ''}${menuCategorySlug ? `:menu:${menuCategorySlug}` : ''}`,
    vendorSearch: (term: string, eventId?: string) =>
        `vendors:search:${term}${eventId ? `:event:${eventId}` : ''}`,
    vendorsWithItemsByCategory: (categoryId: string, eventId?: string) =>
        `vendors:menuCategory:${categoryId}${eventId ? `:event:${eventId}` : ''}`,
    eventMenuCategories: (eventId: string) => `vendors:event:${eventId}:menuCategories`,
} as const;

// Select string that joins vendor_categories with category names
const VENDOR_SELECT_WITH_CATEGORIES = '*, vendor_categories(category_id, categories(id, name))';

/**
 * Batch-fetch vendor_categories for a list of DB vendor rows and attach
 * `vendor_categories` to each row in-place. Silently degrades if the
 * junction table doesn't exist yet (migration not applied).
 */
async function enrichWithCategories(vendorRows: any[]): Promise<void> {
    if (vendorRows.length === 0) return;
    try {
        const ids = vendorRows.map(v => v.id);
        const { data: vcRows, error } = await supabase
            .from('vendor_categories')
            .select('vendor_id, category_id, categories(id, name)')
            .in('vendor_id', ids);

        if (error || !vcRows) return; // degrade silently

        const byVendor = new Map<string, any[]>();
        for (const row of vcRows) {
            const list = byVendor.get(row.vendor_id) || [];
            list.push(row);
            byVendor.set(row.vendor_id, list);
        }
        for (const v of vendorRows) {
            v.vendor_categories = byVendor.get(v.id) || [];
        }
    } catch {
        // junction table may not exist yet – continue without enrichment
    }
}

export class VendorService {
    async getAllVendors(excludeEventId?: string): Promise<Vendor[]> {
        const cacheKey = cacheKeys.allVendors();

        try {
            // For unfiltered requests, use getOrFetch with singleflight
            if (!excludeEventId) {
                return await cache.getOrFetch<Vendor[]>(cacheKey, async () => {
                    const { data, error } = await supabase
                        .from('vendors')
                        .select('*');

                    if (error) {
                        throw new Error(`Failed to fetch vendors: ${error.message}`);
                    }

                    await enrichWithCategories(data || []);
                    return (data || []).map(dbVendor => fromDbVendor(dbVendor));
                }, CACHE_TTL.VENDOR_LIST);
            }

            // Reuse cached vendor list and filter in JS to avoid extra DB call
            const allVendors = await cache.getOrFetch<Vendor[]>(cacheKey, async () => {
                const { data, error } = await supabase
                    .from('vendors')
                    .select('*');

                if (error) {
                    throw new Error(`Failed to fetch vendors: ${error.message}`);
                }

                await enrichWithCategories(data || []);
                return (data || []).map(dbVendor => fromDbVendor(dbVendor));
            }, CACHE_TTL.VENDOR_LIST);

            // Look up excluded vendor IDs and filter in JS
            const { data: eventVendors, error: evError } = await supabase
                .from('event_vendors')
                .select('vendor_id')
                .eq('event_id', excludeEventId);

            if (evError) {
                throw new Error(`Failed to fetch event vendors: ${evError.message}`);
            }
            const excludeVendorIds = new Set((eventVendors || []).map(ev => ev.vendor_id));

            return excludeVendorIds.size > 0
                ? allVendors.filter(v => !excludeVendorIds.has(v.id))
                : allVendors;
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

            if (data) await enrichWithCategories([data]);
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
        const { categoryIds, ...rest } = vendor as any;
        const dbVendor = toDbVendor(rest);

        const { data, error } = await supabase
            .from('vendors')
            .insert([dbVendor])
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to create vendor: ${error.message}`);
        }

        // Sync categories via junction table
        if (categoryIds && categoryIds.length > 0) {
            await this.syncVendorCategories(data.id, categoryIds);
        }

        // Fetch the full vendor with categories joined
        const fullVendor = await this.fetchVendorWithCategories(data.id);

        // Invalidate related caches
        await this.invalidateVendorCaches();

        return fullVendor!;
    }

    async updateVendor(id: string, vendor: Partial<Vendor>): Promise<Vendor> {
        const { categoryIds, ...rest } = vendor as any;
        const dbVendor = toDbVendor(rest);

        // Only update vendor row if there are non-category fields to update
        if (Object.keys(dbVendor).length > 0) {
            const { error } = await supabase
                .from('vendors')
                .update(dbVendor)
                .eq('id', id)
                .select()
                .single();

            if (error) {
                throw new Error(`Failed to update vendor: ${error.message}`);
            }
        }

        // Sync categories via junction table if provided
        if (categoryIds && categoryIds.length > 0) {
            await this.syncVendorCategories(id, categoryIds);
        }

        // Fetch the full vendor with categories joined
        const updatedVendor = await this.fetchVendorWithCategories(id);

        // Invalidate all caches for this vendor
        await this.invalidateVendorCaches(id);

        return updatedVendor!;
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

    async getVendorsByCategory(categoryId: string): Promise<Vendor[]> {
        const cacheKey = cacheKeys.vendorsByCategory(categoryId);

        try {
            // Try cache first
            const cached = await cache.get<Vendor[]>(cacheKey);
            if (cached) {
                return cached;
            }

            // Find vendor IDs from junction table
            const { data: vcRows, error: vcError } = await supabase
                .from('vendor_categories')
                .select('vendor_id')
                .eq('category_id', categoryId);

            if (vcError) {
                throw new Error(`Failed to fetch vendors by category: ${vcError.message}`);
            }

            const vendorIds = (vcRows || []).map((row: any) => row.vendor_id);

            if (vendorIds.length === 0) {
                await cache.set(cacheKey, [], CACHE_TTL.VENDOR_LIST);
                return [];
            }

            // Fetch vendors
            const { data, error } = await supabase
                .from('vendors')
                .select('*')
                .in('id', vendorIds)
                .eq('is_active', true);

            if (error) {
                throw new Error(`Failed to fetch vendors by category: ${error.message}`);
            }

            await enrichWithCategories(data || []);
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
                .eq('isActive', true)
                .limit(200);

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
                    .eq('event_id', eventId)
                    .eq('status', 'accepted');
                allowedVendorIds = (eventVendors || []).map((ev: any) => ev.vendor_id);
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
                .from('default_menu_items')
                .select('vendor_id')
                .eq('category_id', categoryId)
                .eq('is_active', true)
                .eq('availability_status', 'AVAILABLE');

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
                .limit(200);

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

    async getAggregatedMenuCategoriesByEvent(
        eventIdOrCode: string
    ): Promise<{ slug: string; name: string; vendorCount: number; imageUrl?: string }[]> {
        const eventId = await this.getEventByIdOrCode(eventIdOrCode);
        if (!eventId) {
            throw new Error('Event not found');
        }

        const cacheKey = cacheKeys.eventMenuCategories(eventId);

        try {
            const cached = await cache.get<{ slug: string; name: string; vendorCount: number; imageUrl?: string }[]>(cacheKey);
            if (cached) return cached;

            // Get vendor IDs for this event (only accepted vendors)
            const { data: eventVendors, error: junctionError } = await supabase
                .from('event_vendors')
                .select('vendor_id')
                .eq('event_id', eventId)
                .eq('status', 'accepted');

            if (junctionError) {
                throw new Error(`Failed to fetch event vendors: ${junctionError.message}`);
            }

            const vendorIds = (eventVendors || []).map((ev: any) => ev.vendor_id);
            if (vendorIds.length === 0) {
                await cache.set(cacheKey, [], CACHE_TTL.MENU_ITEMS);
                return [];
            }

            // Get all active menu categories for these vendors
            const { data: menuCats, error: catError } = await supabase
                .from('menu_categories')
                .select('slug, name, vendor_id, image_url')
                .eq('is_active', true)
                .in('vendor_id', vendorIds);

            if (catError) {
                throw new Error(`Failed to fetch menu categories: ${catError.message}`);
            }

            if (!menuCats || menuCats.length === 0) {
                await cache.set(cacheKey, [], CACHE_TTL.MENU_ITEMS);
                return [];
            }

            // Group by slug — pick the most common name per slug, count distinct vendors
            const slugMap = new Map<string, { names: Map<string, number>; vendors: Set<string>; imageUrl?: string }>();
            for (const row of menuCats) {
                const slug = row.slug as string;
                if (!slugMap.has(slug)) {
                    slugMap.set(slug, { names: new Map(), vendors: new Set(), imageUrl: row.image_url ?? undefined });
                }
                const entry = slugMap.get(slug)!;
                entry.names.set(row.name, (entry.names.get(row.name) || 0) + 1);
                entry.vendors.add(row.vendor_id);
                if (!entry.imageUrl && row.image_url) {
                    entry.imageUrl = row.image_url;
                }
            }

            const result = Array.from(slugMap.entries()).map(([slug, entry]) => {
                // Pick the most common name for this slug
                let bestName = '';
                let bestCount = 0;
                for (const [name, count] of entry.names) {
                    if (count > bestCount) {
                        bestName = name;
                        bestCount = count;
                    }
                }
                return {
                    slug,
                    name: bestName,
                    vendorCount: entry.vendors.size,
                    imageUrl: entry.imageUrl,
                };
            });

            // Sort by vendor count descending
            result.sort((a, b) => b.vendorCount - a.vendorCount);

            await cache.set(cacheKey, result, CACHE_TTL.MENU_ITEMS);
            return result;
        } catch (error) {
            console.error('Error in getAggregatedMenuCategoriesByEvent:', error);
            throw error;
        }
    }

    private async getEventByIdOrCode(eventIdOrCode: string): Promise<string | null> {
        return eventService.getEventByIdOrCode(eventIdOrCode);
    }

    async getVendorsByEvent(
        eventIdOrCode: string,
        opts?: { page?: number; pageSize?: number; categoryId?: string; menuCategorySlug?: string }
    ): Promise<{ id: string, vendors: (Vendor & { menu: any[] })[]; page: number; pageSize: number; total: number; totalPages: number; }> {
        // Normalize pagination
        const page = Math.max(1, Number(opts?.page || 1));
        const pageSize = Math.min(100, Math.max(1, Number(opts?.pageSize || 20)));
        const categoryId = opts?.categoryId;
        const menuCategorySlug = opts?.menuCategorySlug;
        const from = (page - 1) * pageSize;

        // Get the actual event ID (works with both ID and code)
        const eventId = await this.getEventByIdOrCode(eventIdOrCode);
        if (!eventId) {
            throw new Error('Event not found');
        }

        const cacheKey = cacheKeys.vendorsByEvent(eventId, page, pageSize, categoryId, menuCategorySlug);

        try {
            return await cache.getOrFetch(cacheKey, async () => {
                // Try single RPC call first (requires migration to be applied)
                const rpcResult = await safeQuery<any>(() => Promise.resolve(supabase.rpc('get_vendors_by_event', {
                    p_event_id: eventId,
                })));

                // If RPC exists, use its data; otherwise fall back to multi-query path
                const useRpc = !rpcResult.error;
                if (rpcResult.error && !rpcResult.error.message?.includes('Could not find the function')) {
                    throw new Error(`Failed to fetch vendors by event: ${rpcResult.error.message}`);
                }

                let displayOrderMap: Map<string, number | null>;
                let menuByVendor: Map<string, any[]>;
                let vendorData: { vendor: Vendor; eventConfig: any; orderCount: number }[];

                if (useRpc) {
                    // ── Fast path: single RPC returned all data ──────────────
                    const allVendors: any[] = rpcResult.data || [];
                    if (allVendors.length === 0) {
                        return { id: eventId, vendors: [], page, pageSize, total: 0, totalPages: 0 };
                    }

                    displayOrderMap = new Map();
                    menuByVendor = new Map();

                    vendorData = allVendors.map((row: any) => {
                        displayOrderMap.set(row.id, row.display_order ?? null);
                        const menuItems = (row.menu_items || []).map((mi: any) => ({
                            id: mi.id, vendorId: mi.vendor_id, categoryId: mi.category_id,
                            name: mi.name, description: mi.description, price: mi.base_price,
                            imageUrl: mi.image_url, type: mi.type, prepTime: mi.prep_time,
                            available: true, isAlcohol: mi.is_alcohol ?? false,
                            createdAt: mi.created_at, updatedAt: mi.updated_at,
                        }));
                        menuByVendor.set(row.id, menuItems);
                        const dbRow = { ...row, vendor_categories: row.vendor_categories || [] };
                        return { vendor: fromDbVendor(dbRow), eventConfig: row.event_config, orderCount: row.order_count || 0 };
                    });
                } else {
                    // ── Fallback: multi-query path (RPC not deployed yet) ────
                    const { data: eventVendors, error: junctionError } = await supabase
                        .from('event_vendors')
                        .select('vendor_id, display_order')
                        .eq('event_id', eventId)
                        .eq('status', 'accepted');
                    if (junctionError) throw new Error(`Failed to fetch event vendors: ${junctionError.message}`);

                    displayOrderMap = new Map();
                    for (const ev of eventVendors || []) displayOrderMap.set(ev.vendor_id, ev.display_order ?? null);

                    let vendorIds = (eventVendors || []).map((ev: any) => ev.vendor_id);
                    if (vendorIds.length === 0) {
                        return { id: eventId, vendors: [], page, pageSize, total: 0, totalPages: 0 };
                    }

                    if (categoryId) {
                        const { data: vcRows } = await supabase.from('vendor_categories').select('vendor_id').eq('category_id', categoryId).in('vendor_id', vendorIds);
                        const catSet = new Set((vcRows || []).map((r: any) => r.vendor_id));
                        vendorIds = vendorIds.filter((id: string) => catSet.has(id));
                        if (vendorIds.length === 0) return { id: eventId, vendors: [], page, pageSize, total: 0, totalPages: 0 };
                    }

                    if (menuCategorySlug) {
                        const { data: mcRows } = await supabase.from('menu_categories').select('vendor_id').eq('slug', menuCategorySlug).eq('is_active', true).in('vendor_id', vendorIds);
                        const mcSet = new Set((mcRows || []).map((r: any) => r.vendor_id));
                        vendorIds = vendorIds.filter((id: string) => mcSet.has(id));
                        if (vendorIds.length === 0) return { id: eventId, vendors: [], page, pageSize, total: 0, totalPages: 0 };
                    }

                    const { data: vendorRows, error: vendorError } = await supabase
                        .from('vendors')
                        .select('id, name, description, phone, email, image_url, logo_url, category_id, cuisine_type, rating, total_reviews, location, hours, is_active, is_paused, minimum_order, delivery_fee, service_fee_percent, estimated_prep_time, payment_methods, created_at, updated_at')
                        .in('id', vendorIds)
                        .eq('is_active', true);
                    if (vendorError) throw new Error(`Failed to fetch vendors for event: ${vendorError.message}`);

                    await enrichWithCategories(vendorRows || []);
                    const vendors = (vendorRows || []).map(fromDbVendor);
                    const allVendorIds = vendors.map(v => v.id);

                    menuByVendor = new Map();
                    if (allVendorIds.length > 0) {
                        const { data: menuRows } = await supabase
                            .from('default_menu_items')
                            .select('id, vendor_id, category_id, name, description, base_price, image_url, type, prep_time, is_alcohol, created_at, updated_at')
                            .in('vendor_id', allVendorIds).eq('is_active', true).eq('availability_status', 'AVAILABLE');
                        for (const row of menuRows || []) {
                            const item = { id: row.id, vendorId: row.vendor_id, categoryId: row.category_id, name: row.name, description: row.description, price: row.base_price, imageUrl: row.image_url, type: row.type, prepTime: row.prep_time, available: true, isAlcohol: row.is_alcohol ?? false, createdAt: row.created_at, updatedAt: row.updated_at };
                            const list = menuByVendor.get(item.vendorId) || [];
                            list.push(item);
                            menuByVendor.set(item.vendorId, list);
                        }
                    }

                    const [eventStatuses, orderCountMap] = await Promise.all([
                        this.getVendorEventStatuses(allVendorIds, eventId),
                        this.getVendorOrderCounts(allVendorIds, eventId),
                    ]);

                    vendorData = vendors.map(v => ({
                        vendor: v,
                        eventConfig: null, // statuses computed by helper
                        orderCount: orderCountMap.get(v.id) || 0,
                    }));

                    // Patch in pre-computed event statuses for the sort below
                    for (const vd of vendorData) {
                        (vd as any)._eventStatus = eventStatuses.get(vd.vendor.id) || 'OPEN';
                    }
                }

                // ── RPC path: filter by category/menuCategorySlug ────────
                if (useRpc && categoryId) {
                    vendorData = vendorData.filter(({ vendor }) => {
                        const cats = (vendor as any).categoryIds || [];
                        return cats.includes(categoryId) ||
                            (rpcResult.data || []).find((r: any) => r.id === vendor.id)?.vendor_categories?.some((vc: any) => vc.category_id === categoryId);
                    });
                }
                if (useRpc && menuCategorySlug) {
                    const vIds = vendorData.map(({ vendor }) => vendor.id);
                    const { data: menuCatRows } = await supabase.from('menu_categories').select('vendor_id').eq('slug', menuCategorySlug).eq('is_active', true).in('vendor_id', vIds);
                    const menuCatVendorIds = new Set((menuCatRows || []).map((r: any) => r.vendor_id));
                    vendorData = vendorData.filter(({ vendor }) => menuCatVendorIds.has(vendor.id));
                }

                if (vendorData.length === 0) {
                    return { id: eventId, vendors: [], page, pageSize, total: 0, totalPages: 0 };
                }

                // ── Compute event statuses (RPC path only; fallback already has them) ──
                const now = new Date();
                const pad = (n: number) => n.toString().padStart(2, '0');
                const saTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }));
                const currentHHMM = `${pad(saTime.getHours())}:${pad(saTime.getMinutes())}`;
                const todayDate = `${saTime.getFullYear()}-${pad(saTime.getMonth() + 1)}-${pad(saTime.getDate())}`;

                const vendorsWithMenu = vendorData.map(({ vendor, eventConfig, orderCount, ...rest }) => {
                    // For fallback path, use pre-computed status
                    let eventStatus: 'OPEN' | 'CLOSED' = (rest as any)._eventStatus || 'OPEN';

                    if (useRpc && eventConfig) {
                        eventStatus = 'OPEN';
                        if (!eventConfig.is_accepting_orders) {
                            eventStatus = 'CLOSED';
                        } else if (eventConfig.status === 'PAUSED' || eventConfig.status === 'CLOSED') {
                            eventStatus = 'CLOSED';
                        } else {
                            const schedule = eventConfig.operating_schedule as any[] | null;
                            const todaySchedule = schedule?.find((s: any) => s.date === todayDate);
                            if (todaySchedule) {
                                if (todaySchedule.isClosed) {
                                    eventStatus = 'CLOSED';
                                } else if (todaySchedule.openTime && todaySchedule.closeTime && todaySchedule.openTime !== todaySchedule.closeTime) {
                                    const effectiveClose = todaySchedule.closeTime === '00:00' ? '24:00' : todaySchedule.closeTime;
                                    if (currentHHMM < todaySchedule.openTime || currentHHMM >= effectiveClose) eventStatus = 'CLOSED';
                                }
                            } else if (eventConfig.event_open_time && eventConfig.event_close_time && eventConfig.event_open_time !== eventConfig.event_close_time) {
                                const effectiveClose = eventConfig.event_close_time === '00:00' ? '24:00' : eventConfig.event_close_time;
                                if (currentHHMM < eventConfig.event_open_time || currentHHMM >= effectiveClose) eventStatus = 'CLOSED';
                            }
                        }
                    }

                    return {
                        ...vendor,
                        menu: (menuByVendor.get(vendor.id) || []).slice(0, 3),
                        eventStatus,
                        orderCount,
                    };
                });

                // 5-tier smart sort
                vendorsWithMenu.sort((a, b) => {
                    const aPin = displayOrderMap.get(a.id);
                    const bPin = displayOrderMap.get(b.id);
                    const aPinned = aPin != null;
                    const bPinned = bPin != null;
                    if (aPinned !== bPinned) return aPinned ? -1 : 1;
                    if (aPinned && bPinned && aPin! !== bPin!) return aPin! - bPin!;

                    const aOpen = a.eventStatus === 'OPEN' ? 0 : 1;
                    const bOpen = b.eventStatus === 'OPEN' ? 0 : 1;
                    if (aOpen !== bOpen) return aOpen - bOpen;

                    const aHasMenu = (menuByVendor.get(a.id) || []).length > 0 ? 0 : 1;
                    const bHasMenu = (menuByVendor.get(b.id) || []).length > 0 ? 0 : 1;
                    if (aHasMenu !== bHasMenu) return aHasMenu - bHasMenu;

                    if (a.orderCount !== b.orderCount) return b.orderCount - a.orderCount;

                    return a.name.localeCompare(b.name);
                });

                const total = vendorsWithMenu.length;
                const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
                const pagedVendors = vendorsWithMenu.slice(from, from + pageSize);

                return { id: eventId, vendors: pagedVendors, page, pageSize, total, totalPages };
            }, CACHE_TTL.VENDOR_DETAILS);
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

                // Get vendor IDs from junction table (only accepted vendors)
                const { data: eventVendors, error: junctionError } = await supabase
                    .from('event_vendors')
                    .select('vendor_id')
                    .eq('event_id', eventId)
                    .eq('status', 'accepted');

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
                .or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`)
                .limit(100);

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

    // ==================== ORDER COUNTS ====================

    /**
     * Returns a map of vendorId → non-cancelled order count for the given event.
     */
    private async getVendorOrderCounts(vendorIds: string[], eventId: string): Promise<Map<string, number>> {
        const countMap = new Map<string, number>();
        if (vendorIds.length === 0) return countMap;

        const { data: orderRows, error } = await supabase
            .from('orders')
            .select('vendor_id')
            .eq('event_id', eventId)
            .in('vendor_id', vendorIds)
            .neq('status', 'CANCELLED')
            .limit(10000);

        if (error) {
            // Non-fatal: degrade to zero counts rather than breaking the listing
            console.error('Failed to fetch order counts for sorting:', error.message);
            return countMap;
        }

        for (const row of orderRows || []) {
            countMap.set(row.vendor_id, (countMap.get(row.vendor_id) || 0) + 1);
        }

        return countMap;
    }

    // ==================== AVAILABILITY FILTERING ====================

    /**
     * Returns a map of vendorId → eventStatus ('OPEN' | 'CLOSED') based on
     * event_menu_configurations (is_accepting_orders, status, operating hours).
     * Vendors without a config default to 'OPEN'.
     */
    private async getVendorEventStatuses(vendorIds: string[], eventId: string): Promise<Map<string, 'OPEN' | 'CLOSED'>> {
        const statusMap = new Map<string, 'OPEN' | 'CLOSED'>();
        for (const id of vendorIds) statusMap.set(id, 'OPEN');

        const { data: configs } = await supabase
            .from('event_menu_configurations')
            .select('vendor_id, is_accepting_orders, status, event_open_time, event_close_time, operating_schedule')
            .eq('event_id', eventId)
            .in('vendor_id', vendorIds);

        if (!configs || configs.length === 0) return statusMap;

        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        // Convert to SA time — server is in Netherlands (UTC+1), events are in SA (UTC+2)
        const saTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }));
        const currentHHMM = `${pad(saTime.getHours())}:${pad(saTime.getMinutes())}`;
        const todayDate = `${saTime.getFullYear()}-${pad(saTime.getMonth() + 1)}-${pad(saTime.getDate())}`;

        for (const config of configs) {
            if (!config.is_accepting_orders) {
                statusMap.set(config.vendor_id, 'CLOSED');
                continue;
            }
            if (config.status === 'PAUSED' || config.status === 'CLOSED') {
                statusMap.set(config.vendor_id, 'CLOSED');
                continue;
            }
            const schedule = config.operating_schedule as any[] | null;
            const todaySchedule = schedule?.find((s: any) => s.date === todayDate);
            if (todaySchedule) {
                if (todaySchedule.isClosed) {
                    statusMap.set(config.vendor_id, 'CLOSED');
                    continue;
                }
                if (todaySchedule.openTime && todaySchedule.closeTime) {
                    // "00:00"/"00:00" means open all day — skip time check
                    if (todaySchedule.openTime !== todaySchedule.closeTime) {
                        // Treat closeTime "00:00" as end of day (midnight)
                        const effectiveClose = todaySchedule.closeTime === '00:00' ? '24:00' : todaySchedule.closeTime;
                        if (currentHHMM < todaySchedule.openTime || currentHHMM >= effectiveClose) {
                            statusMap.set(config.vendor_id, 'CLOSED');
                            continue;
                        }
                    }
                }
            } else if (config.event_open_time && config.event_close_time) {
                if (config.event_open_time !== config.event_close_time) {
                    const effectiveClose = config.event_close_time === '00:00' ? '24:00' : config.event_close_time;
                    if (currentHHMM < config.event_open_time || currentHHMM >= effectiveClose) {
                        statusMap.set(config.vendor_id, 'CLOSED');
                        continue;
                    }
                }
            }
        }

        return statusMap;
    }

    // ==================== VENDOR CATEGORIES ====================

    async syncVendorCategories(vendorId: string, categoryIds: string[]): Promise<void> {
        // Delete existing categories for this vendor
        const { error: deleteError } = await supabase
            .from('vendor_categories')
            .delete()
            .eq('vendor_id', vendorId);

        if (deleteError) {
            throw new Error(`Failed to sync vendor categories: ${deleteError.message}`);
        }

        // Insert new categories
        if (categoryIds.length > 0) {
            const rows = categoryIds.map(categoryId => ({
                vendor_id: vendorId,
                category_id: categoryId,
            }));

            const { error: insertError } = await supabase
                .from('vendor_categories')
                .insert(rows);

            if (insertError) {
                throw new Error(`Failed to sync vendor categories: ${insertError.message}`);
            }
        }
    }

    private async fetchVendorWithCategories(vendorId: string): Promise<Vendor | null> {
        const { data, error } = await supabase
            .from('vendors')
            .select(VENDOR_SELECT_WITH_CATEGORIES)
            .eq('id', vendorId)
            .single();

        if (error) {
            throw new Error(`Failed to fetch vendor: ${error.message}`);
        }

        return data ? fromDbVendor(data) : null;
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
