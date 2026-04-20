import { supabase } from '../lib/supabase.js';
import { cache } from '../lib/redis.js';
import { QRHelper } from '../lib/qr.helper.js';
import { ForbiddenError, ValidationError, NotFoundError } from '../lib/errors.js';
import { VendorEvent, VendorEventWithDetails, CreateVendorEventPayload } from './vendor-event.types.js';
import { fromDbVendorEvent, fromDbVendorEventWithDetails } from './vendor-event.utils.js';
import { nanoid } from 'nanoid';

if (!process.env.CUSTOMER_APP_URL) throw new Error('CUSTOMER_APP_URL environment variable is required');
const CUSTOMER_APP_URL = process.env.CUSTOMER_APP_URL;
const VENDOR_EVENT_CACHE_TTL = 60;

const vendorEventCacheKeys = {
  byVendor: (vendorId: string) => `vendor-events:vendor:${vendorId}`,
  byId: (id: string) => `vendor-events:id:${id}`,
} as const;

export class VendorEventService {
  private qrHelper = new QRHelper();

  private async assertCanCreateEvents(vendorId: string): Promise<{ id: string; name: string }> {
    const { data: vendor, error } = await supabase
      .from('vendors')
      .select('id, name')
      .eq('id', vendorId)
      .single();

    if (error || !vendor) throw new NotFoundError('Vendor not found');
    return { id: vendor.id, name: vendor.name };
  }

  private generateEventCode(vendorName: string): string {
    const prefix = vendorName
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 4)
      .toUpperCase();
    return `${prefix}-${nanoid(6).toUpperCase()}`;
  }

  async createVendorEvent(vendorId: string, payload: CreateVendorEventPayload): Promise<VendorEvent> {
    const vendor = await this.assertCanCreateEvents(vendorId);

    const eventCode = this.generateEventCode(vendor.name);

    // 1. Create the event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .insert({
        name: payload.name,
        start_date: payload.startDate,
        end_date: payload.endDate,
        status: 'ACTIVE',
        code: eventCode,
        origin_type: 'vendor',
        is_public: true,
        location: { latitude: 0, longitude: 0, address: 'N/A', city: 'N/A', state: 'N/A', zipCode: '0000' },
      })
      .select()
      .single();

    if (eventError) throw new Error(`Failed to create event: ${eventError.message}`);

    // 2. Create event_vendors junction (vendor owns this event)
    const { error: evError } = await supabase
      .from('event_vendors')
      .insert({ event_id: event.id, vendor_id: vendorId, status: 'accepted' });

    if (evError) throw new Error(`Failed to link vendor to event: ${evError.message}`);

    // 3. Create event_menu_configurations (default config)
    const menuConfig: Record<string, any> = {
      event_id: event.id,
      vendor_id: vendorId,
      is_accepting_orders: true,
      current_active_orders: 0,
      status: 'DRAFT',
      category_configurations: [],
      allow_pay_at_stall: payload.allowPayAtStall ?? false,
    };
    if (payload.menuTemplateId) {
      menuConfig.template_id = payload.menuTemplateId;
    }
    const { error: menuError } = await supabase
      .from('event_menu_configurations')
      .insert([menuConfig]);

    if (menuError) throw new Error(`Failed to create menu config: ${menuError.message}`);

    // 4. Generate QR code — image encodes customer URL, qr_code stores HMAC for verification
    const qrString = this.qrHelper.generateVendorEventQR(event.id, vendorId);
    const customerUrl = `${CUSTOMER_APP_URL}/e/${eventCode}/v/${vendorId}`;
    const qrBuffer = await this.qrHelper.generateQRCodeBuffer(customerUrl);
    const qrImageUrl = await this.qrHelper.uploadVendorEventQRImage(qrBuffer, `${event.id}-${vendorId}`);

    // 5. Create vendor_events record
    const { data: vendorEvent, error: veError } = await supabase
      .from('vendor_events')
      .insert({
        event_id: event.id,
        vendor_id: vendorId,
        qr_code: qrString,
        qr_image: qrImageUrl,
        menu_template_id: payload.menuTemplateId || null,
        is_direct: false,
      })
      .select()
      .single();

    if (veError) throw new Error(`Failed to create vendor event: ${veError.message}`);

    // 6. Invalidate caches
    await cache.del(vendorEventCacheKeys.byVendor(vendorId));

    return fromDbVendorEvent(vendorEvent);
  }

  async getOrCreateDirectQR(vendorId: string): Promise<VendorEventWithDetails> {
    const vendor = await this.assertCanCreateEvents(vendorId);

    // Check if direct QR already exists
    const { data: existing } = await supabase
      .from('vendor_events')
      .select('*, events(name, code, start_date, end_date, status)')
      .eq('vendor_id', vendorId)
      .eq('is_direct', true)
      .single();

    if (existing) return fromDbVendorEventWithDetails(existing);

    // Create persistent "always-on" event
    const eventCode = this.generateEventCode(vendor.name);
    const { data: event, error: eventError } = await supabase
      .from('events')
      .insert({
        name: `${vendor.name} - Direct`,
        start_date: new Date().toISOString(),
        end_date: '2099-12-31T23:59:59Z',
        status: 'ACTIVE',
        code: eventCode,
        origin_type: 'vendor_direct',
        is_public: true,
        location: { latitude: 0, longitude: 0, address: 'N/A', city: 'N/A', state: 'N/A', zipCode: '0000' },
      })
      .select()
      .single();

    if (eventError) throw new Error(`Failed to create direct event: ${eventError.message}`);

    // Create event_vendors junction
    const { error: evError } = await supabase
      .from('event_vendors')
      .insert({ event_id: event.id, vendor_id: vendorId, status: 'accepted' });

    if (evError) throw new Error(`Failed to link vendor to direct event: ${evError.message}`);

    // Create default menu config
    const { error: menuError } = await supabase
      .from('event_menu_configurations')
      .insert([{
        event_id: event.id,
        vendor_id: vendorId,
        is_accepting_orders: true,
        current_active_orders: 0,
        status: 'DRAFT',
        category_configurations: [],
      }]);

    if (menuError) throw new Error(`Failed to create direct menu config: ${menuError.message}`);

    // Generate direct QR — image encodes customer URL with eventId for instant redirect
    const qrString = this.qrHelper.generateVendorDirectQR(vendorId);
    const customerUrl = `${CUSTOMER_APP_URL}/e/${eventCode}/v/${vendorId}?eventId=${event.id}`;
    const qrBuffer = await this.qrHelper.generateQRCodeBuffer(customerUrl);
    const qrImageUrl = await this.qrHelper.uploadVendorEventQRImage(qrBuffer, `direct-${vendorId}`);

    const { data: vendorEvent, error: veError } = await supabase
      .from('vendor_events')
      .insert({
        event_id: event.id,
        vendor_id: vendorId,
        qr_code: qrString,
        qr_image: qrImageUrl,
        menu_template_id: null,
        is_direct: true,
      })
      .select()
      .single();

    if (veError) throw new Error(`Failed to create direct vendor event: ${veError.message}`);

    await cache.del(vendorEventCacheKeys.byVendor(vendorId));

    // Attach the event data we already have from the insert above
    vendorEvent.events = {
      name: event.name,
      code: event.code,
      start_date: event.start_date,
      end_date: event.end_date,
      status: event.status,
    };

    return fromDbVendorEventWithDetails(vendorEvent);
  }

  async listVendorEvents(vendorId: string): Promise<VendorEventWithDetails[]> {
    const { data, error } = await supabase
      .from('vendor_events')
      .select('*, events(name, code, start_date, end_date, status)')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to list vendor events: ${error.message}`);

    return (data || []).map(fromDbVendorEventWithDetails);
  }

  async getVendorEvent(id: string, vendorId: string): Promise<VendorEventWithDetails> {
    const { data, error } = await supabase
      .from('vendor_events')
      .select('*, events(name, code, start_date, end_date, status)')
      .eq('id', id)
      .eq('vendor_id', vendorId)
      .single();

    if (error || !data) throw new NotFoundError('Vendor event not found');

    return fromDbVendorEventWithDetails(data);
  }

  async updateVendorEvent(id: string, vendorId: string, updates: { name?: string; startDate?: string; endDate?: string }): Promise<VendorEventWithDetails> {
    const { data: ve, error: veError } = await supabase
      .from('vendor_events')
      .select('event_id')
      .eq('id', id)
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .single();

    if (veError || !ve) throw new NotFoundError('Vendor event not found');

    const eventUpdates: Record<string, any> = {};
    if (updates.name) eventUpdates.name = updates.name;
    if (updates.startDate) eventUpdates.start_date = updates.startDate;
    if (updates.endDate) eventUpdates.end_date = updates.endDate;

    if (Object.keys(eventUpdates).length > 0) {
      const { error } = await supabase
        .from('events')
        .update(eventUpdates)
        .eq('id', ve.event_id);

      if (error) throw new Error(`Failed to update event: ${error.message}`);
    }

    await cache.del(vendorEventCacheKeys.byVendor(vendorId));
    await cache.del(`events:id:${ve.event_id}`);

    return this.getVendorEvent(id, vendorId);
  }

  async deactivateVendorEvent(id: string, vendorId: string): Promise<void> {
    const { data: ve, error: veError } = await supabase
      .from('vendor_events')
      .select('event_id')
      .eq('id', id)
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .single();

    if (veError || !ve) throw new NotFoundError('Vendor event not found');

    await supabase
      .from('events')
      .update({ status: 'CANCELED' })
      .eq('id', ve.event_id);

    await cache.del(vendorEventCacheKeys.byVendor(vendorId));
    await cache.del(`events:id:${ve.event_id}`);
  }

  async updateDirectQRMenu(vendorId: string, menuTemplateId: string | null): Promise<VendorEvent> {
    const { data, error } = await supabase
      .from('vendor_events')
      .update({ menu_template_id: menuTemplateId })
      .eq('vendor_id', vendorId)
      .eq('is_direct', true)
      .select()
      .single();

    if (error || !data) throw new NotFoundError('Direct QR not found for this vendor');

    await supabase
      .from('event_menu_configurations')
      .update({ template_id: menuTemplateId })
      .eq('event_id', data.event_id)
      .eq('vendor_id', vendorId);

    await cache.del(vendorEventCacheKeys.byVendor(vendorId));

    return fromDbVendorEvent(data);
  }

  async getVendorEventOrders(vendorId: string, params: { status?: string; page?: number; limit?: number } = {}): Promise<{ orders: any[]; total: number; stats: { totalOrders: number; totalRevenue: number; activeOrders: number } }> {
    const page = params.page || 1;
    const limit = Math.min(params.limit || 50, 100);
    const offset = (page - 1) * limit;

    // 1. Get all event IDs for this vendor's events (single query, cached)
    const eventIds = await cache.getOrFetch<string[]>(
      vendorEventCacheKeys.byVendor(vendorId) + ':event-ids',
      async () => {
        const { data: veRows, error: veError } = await supabase
          .from('vendor_events')
          .select('event_id')
          .eq('vendor_id', vendorId);
        if (veError) throw new Error(`Failed to fetch vendor events: ${veError.message}`);
        return (veRows || []).map((r: any) => r.event_id);
      },
      VENDOR_EVENT_CACHE_TTL
    );

    if (eventIds.length === 0) {
      return { orders: [], total: 0, stats: { totalOrders: 0, totalRevenue: 0, activeOrders: 0 } };
    }

    // 2. Query orders filtered by those event IDs (DB does the work)
    let query = supabase
      .from('orders')
      .select('*', { count: 'exact' })
      .eq('vendor_id', vendorId)
      .in('event_id', eventIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (params.status) {
      query = query.eq('status', params.status);
    }

    // 3. Stats query in parallel (no pagination, just aggregation)
    const [ordersResult, statsResult] = await Promise.all([
      query,
      supabase
        .from('orders')
        .select('total, status')
        .eq('vendor_id', vendorId)
        .in('event_id', eventIds),
    ]);

    if (ordersResult.error) throw new Error(`Failed to fetch orders: ${ordersResult.error.message}`);

    const allOrders = statsResult.data || [];
    const nonCancelled = allOrders.filter((o: any) => o.status !== 'CANCELLED');
    const active = allOrders.filter((o: any) => o.status === 'PENDING' || o.status === 'PREPARING');
    const revenue = nonCancelled.reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);

    return {
      orders: ordersResult.data || [],
      total: ordersResult.count || 0,
      stats: {
        totalOrders: nonCancelled.length,
        totalRevenue: Math.round(revenue * 100) / 100,
        activeOrders: active.length,
      },
    };
  }

  async getVendorEventQR(id: string, vendorId: string): Promise<{ qrCode: string; qrImage: string }> {
    const { data, error } = await supabase
      .from('vendor_events')
      .select('qr_code, qr_image')
      .eq('id', id)
      .eq('vendor_id', vendorId)
      .single();

    if (error || !data) throw new NotFoundError('Vendor event not found');

    return { qrCode: data.qr_code, qrImage: data.qr_image };
  }
}
