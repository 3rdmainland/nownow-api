import { supabase } from '../lib/supabase.js';
import { cache } from '../lib/redis.js';
import { QRHelper } from '../lib/qr.helper.js';
import { ForbiddenError, NotFoundError, ConflictError } from '../lib/errors.js';
import { Stall, StallWithDetails, CreateStallPayload } from './stall.types.js';
import { fromDbStall, fromDbStallWithDetails } from './stall.utils.js';

if (!process.env.CUSTOMER_APP_URL) throw new Error('CUSTOMER_APP_URL environment variable is required');
const CUSTOMER_APP_URL = process.env.CUSTOMER_APP_URL;
const STALL_CACHE_TTL = 60;

const stallCacheKeys = {
  byVendor: (vendorId: string) => `stalls:vendor:${vendorId}`,
} as const;

export class StallService {
  private qrHelper = new QRHelper();

  async listAvailableEvents(vendorId: string): Promise<{ id: string; name: string; code: string; startDate: string; endDate: string; status: string }[]> {
    // Get events where vendor is accepted
    const { data: eventVendors, error: evError } = await supabase
      .from('event_vendors')
      .select('event_id, events(id, name, code, start_date, end_date, status, origin_type)')
      .eq('vendor_id', vendorId)
      .eq('status', 'accepted');

    if (evError) throw new Error(`Failed to fetch event vendors: ${evError.message}`);

    // Filter to organizer-created, ACTIVE events
    const eligibleEvents = (eventVendors || [])
      .map((ev: any) => ev.events)
      .filter((e: any) => e && e.origin_type === 'organizer' && e.status === 'ACTIVE');

    if (eligibleEvents.length === 0) return [];

    const eligibleEventIds = eligibleEvents.map((e: any) => e.id);

    // Get events the vendor already has a stall for
    const { data: existingStalls, error: stallError } = await supabase
      .from('vendor_events')
      .select('event_id')
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .in('event_id', eligibleEventIds);

    if (stallError) throw new Error(`Failed to check existing stalls: ${stallError.message}`);

    const stallEventIds = new Set((existingStalls || []).map((s: any) => s.event_id));

    return eligibleEvents
      .filter((e: any) => !stallEventIds.has(e.id))
      .map((e: any) => ({
        id: e.id,
        name: e.name,
        code: e.code,
        startDate: e.start_date,
        endDate: e.end_date,
        status: e.status,
      }));
  }

  async createStall(vendorId: string, payload: CreateStallPayload): Promise<Stall> {
    const { eventId } = payload;

    // 1. Verify vendor is accepted into the event
    const { data: eventVendor, error: evError } = await supabase
      .from('event_vendors')
      .select('id')
      .eq('vendor_id', vendorId)
      .eq('event_id', eventId)
      .eq('status', 'accepted')
      .single();

    if (evError || !eventVendor) throw new ForbiddenError('Vendor is not accepted into this event');

    // 2. Verify event is organizer-created and ACTIVE
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, code, origin_type, status')
      .eq('id', eventId)
      .single();

    if (eventError || !event) throw new NotFoundError('Event not found');
    if (event.origin_type !== 'organizer') throw new ForbiddenError('Event is not an organizer-created event');
    if (event.status !== 'ACTIVE') throw new ForbiddenError('Event is not active');

    // 3. Check vendor doesn't already have a stall at this event
    const { data: existingStall } = await supabase
      .from('vendor_events')
      .select('id')
      .eq('vendor_id', vendorId)
      .eq('event_id', eventId)
      .eq('is_direct', false)
      .single();

    if (existingStall) throw new ConflictError('Vendor already has a stall at this event');

    // 4. Create event_menu_configurations entry
    const menuConfig: Record<string, any> = {
      event_id: eventId,
      vendor_id: vendorId,
      is_accepting_orders: true,
      current_active_orders: 0,
      status: 'DRAFT',
      category_configurations: [],
      allow_pay_at_stall: payload.allowPayAtStall ?? true,
    };
    if (payload.menuTemplateId) menuConfig.template_id = payload.menuTemplateId;
    if (payload.boothInfo) menuConfig.booth_info = payload.boothInfo;

    const { error: menuError } = await supabase
      .from('event_menu_configurations')
      .insert([menuConfig]);

    if (menuError) throw new Error(`Failed to create menu config: ${menuError.message}`);

    // 5. Generate QR code
    const qrString = this.qrHelper.generateVendorEventQR(eventId, vendorId);
    const customerUrl = `${CUSTOMER_APP_URL}/e/${event.code}/v/${vendorId}`;
    const qrBuffer = await this.qrHelper.generateQRCodeBuffer(customerUrl);
    const qrImageUrl = await this.qrHelper.uploadVendorEventQRImage(qrBuffer, `stall-${eventId}-${vendorId}`);

    // 6. Insert into vendor_events
    const { data: vendorEvent, error: veError } = await supabase
      .from('vendor_events')
      .insert({
        event_id: eventId,
        vendor_id: vendorId,
        qr_code: qrString,
        qr_image: qrImageUrl,
        menu_template_id: payload.menuTemplateId || null,
        is_direct: false,
      })
      .select()
      .single();

    if (veError) throw new Error(`Failed to create stall: ${veError.message}`);

    // 7. Invalidate cache
    await cache.del(stallCacheKeys.byVendor(vendorId));

    return fromDbStall(vendorEvent);
  }

  async listStalls(vendorId: string): Promise<StallWithDetails[]> {
    const { data, error } = await supabase
      .from('vendor_events')
      .select('*, events(name, code, start_date, end_date, status, origin_type)')
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to list stalls: ${error.message}`);

    // Filter to organizer events only
    const stallRows = (data || []).filter((row: any) => row.events?.origin_type === 'organizer');

    if (stallRows.length === 0) return [];

    const eventIds = stallRows.map((row: any) => row.event_id);

    // Enrich with booth_info from event_menu_configurations
    const { data: menuConfigs } = await supabase
      .from('event_menu_configurations')
      .select('event_id, booth_info')
      .eq('vendor_id', vendorId)
      .in('event_id', eventIds);

    const boothInfoMap = new Map(
      (menuConfigs || []).map((mc: any) => [mc.event_id, mc.booth_info ?? null])
    );

    return stallRows.map((row: any) => {
      row.booth_info = boothInfoMap.get(row.event_id) ?? null;
      return fromDbStallWithDetails(row);
    });
  }

  async getStall(id: string, vendorId: string): Promise<StallWithDetails> {
    const { data, error } = await supabase
      .from('vendor_events')
      .select('*, events(name, code, start_date, end_date, status, origin_type)')
      .eq('id', id)
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .single();

    if (error || !data) throw new NotFoundError('Stall not found');
    if (data.events?.origin_type !== 'organizer') throw new NotFoundError('Stall not found');

    // Get booth_info from event_menu_configurations
    const { data: menuConfig } = await supabase
      .from('event_menu_configurations')
      .select('booth_info')
      .eq('event_id', data.event_id)
      .eq('vendor_id', vendorId)
      .single();

    data.booth_info = menuConfig?.booth_info ?? null;

    return fromDbStallWithDetails(data);
  }

  async updateStall(
    id: string,
    vendorId: string,
    updates: { menuTemplateId?: string | null; boothInfo?: string | null; allowPayAtStall?: boolean }
  ): Promise<StallWithDetails> {
    // Verify stall exists
    const { data: existing, error: fetchError } = await supabase
      .from('vendor_events')
      .select('id, event_id')
      .eq('id', id)
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .single();

    if (fetchError || !existing) throw new NotFoundError('Stall not found');

    // Update vendor_events.menu_template_id if provided
    if (updates.menuTemplateId !== undefined) {
      const { error: veError } = await supabase
        .from('vendor_events')
        .update({ menu_template_id: updates.menuTemplateId })
        .eq('id', id)
        .eq('vendor_id', vendorId);

      if (veError) throw new Error(`Failed to update stall: ${veError.message}`);
    }

    // Update event_menu_configurations
    const menuUpdates: Record<string, any> = {};
    if (updates.boothInfo !== undefined) menuUpdates.booth_info = updates.boothInfo;
    if (updates.allowPayAtStall !== undefined) menuUpdates.allow_pay_at_stall = updates.allowPayAtStall;
    if (updates.menuTemplateId !== undefined) menuUpdates.template_id = updates.menuTemplateId;

    if (Object.keys(menuUpdates).length > 0) {
      const { error: menuError } = await supabase
        .from('event_menu_configurations')
        .update(menuUpdates)
        .eq('event_id', existing.event_id)
        .eq('vendor_id', vendorId);

      if (menuError) throw new Error(`Failed to update menu config: ${menuError.message}`);
    }

    // Invalidate cache
    await cache.del(stallCacheKeys.byVendor(vendorId));

    return this.getStall(id, vendorId);
  }

  async deactivateStall(id: string, vendorId: string): Promise<void> {
    // Verify stall exists
    const { data: existing, error: fetchError } = await supabase
      .from('vendor_events')
      .select('id, event_id')
      .eq('id', id)
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .single();

    if (fetchError || !existing) throw new NotFoundError('Stall not found');

    // DELETE the vendor_events record
    const { error: veError } = await supabase
      .from('vendor_events')
      .delete()
      .eq('id', id)
      .eq('vendor_id', vendorId);

    if (veError) throw new Error(`Failed to delete stall: ${veError.message}`);

    // DELETE the event_menu_configurations record
    await supabase
      .from('event_menu_configurations')
      .delete()
      .eq('event_id', existing.event_id)
      .eq('vendor_id', vendorId);

    // Invalidate cache
    await cache.del(stallCacheKeys.byVendor(vendorId));
  }

  async getStallQR(id: string, vendorId: string): Promise<{ qrCode: string; qrImage: string }> {
    const { data, error } = await supabase
      .from('vendor_events')
      .select('qr_code, qr_image')
      .eq('id', id)
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .single();

    if (error || !data) throw new NotFoundError('Stall not found');

    return { qrCode: data.qr_code, qrImage: data.qr_image };
  }
}
