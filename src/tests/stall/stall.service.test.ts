import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseMock, createSupabaseMock } from '../mocks/supabase.js';
import { cacheMock } from '../mocks/redis.js';

vi.mock('../../lib/supabase.js', () => ({
  supabase: supabaseMock,
  safeQuery: (fn: any) => fn(),
}));
vi.mock('../../lib/redis.js', () => ({
  cache: cacheMock,
  default: { ping: vi.fn() },
  CACHE_TTL: { VENDOR_LIST: 3600, VENDOR_DETAILS: 60, MENU_ITEMS: 300, ACTIVE_ORDERS: 5 },
}));
vi.mock('../../lib/qr.helper.js', () => ({
  QRHelper: class {
    generateVendorEventQR = vi.fn().mockReturnValue('VENDOR_EVENT:eid:vid:sig123');
    generateVendorDirectQR = vi.fn().mockReturnValue('VENDOR_DIRECT:vid:sig456');
    generateQRCodeBuffer = vi.fn().mockResolvedValue(Buffer.from('fake-png'));
    uploadVendorEventQRImage = vi.fn().mockResolvedValue('https://storage.test/qr.png');
  },
}));

import { StallService } from '../../stall/stall.service.js';

function mockFromSequence(responses: ReturnType<typeof createSupabaseMock>[]) {
  let i = 0;
  supabaseMock.from.mockImplementation(() => {
    const mock = responses[i] ?? createSupabaseMock({ data: null, error: null });
    i++;
    return mock;
  });
}

describe('StallService', () => {
  let service: StallService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StallService();
  });

  describe('createStall', () => {
    it('creates a stall when vendor is accepted into an organizer event', async () => {
      const vendorId = 'v-1';
      const eventId = 'e-1';

      const eventVendorRow = { id: 'ev-1' };
      const eventRow = { id: eventId, code: 'JOLL-abc', origin_type: 'organizer', status: 'ACTIVE' };
      const stallRow = {
        id: 'stall-1',
        event_id: eventId,
        vendor_id: vendorId,
        qr_code: 'VENDOR_EVENT:eid:vid:sig123',
        qr_image: 'https://storage.test/qr.png',
        menu_template_id: null,
        is_direct: false,
        created_at: '2026-04-14T00:00:00Z',
        updated_at: '2026-04-14T00:00:00Z',
      };

      mockFromSequence([
        // 1. event_vendors check (vendor accepted)
        createSupabaseMock({ data: eventVendorRow, error: null }),
        // 2. events lookup
        createSupabaseMock({ data: eventRow, error: null }),
        // 3. vendor_events duplicate check (not found)
        createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'not found' } }),
        // 4. event_menu_configurations insert
        createSupabaseMock({ data: null, error: null }),
        // 5. vendor_events insert
        createSupabaseMock({ data: stallRow, error: null }),
      ]);

      const result = await service.createStall(vendorId, { eventId });

      expect(result.id).toBe('stall-1');
      expect(result.eventId).toBe(eventId);
      expect(result.vendorId).toBe(vendorId);
      expect(result.qrImage).toBe('https://storage.test/qr.png');
    });

    it('throws ForbiddenError when vendor is not accepted into event', async () => {
      mockFromSequence([
        // event_vendors check returns error (vendor not accepted)
        createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'not found' } }),
      ]);

      await expect(
        service.createStall('v-1', { eventId: 'e-1' })
      ).rejects.toThrow('Vendor is not accepted into this event');
    });

    it('throws ForbiddenError when event is not organizer-created', async () => {
      const eventVendorRow = { id: 'ev-1' };
      const eventRow = { id: 'e-1', code: 'VEND-abc', origin_type: 'vendor', status: 'ACTIVE' };

      mockFromSequence([
        // 1. event_vendors check (accepted)
        createSupabaseMock({ data: eventVendorRow, error: null }),
        // 2. events lookup (vendor-created)
        createSupabaseMock({ data: eventRow, error: null }),
      ]);

      await expect(
        service.createStall('v-1', { eventId: 'e-1' })
      ).rejects.toThrow('Event is not an organizer-created event');
    });

    it('throws ConflictError when vendor already has a stall at event', async () => {
      const eventVendorRow = { id: 'ev-1' };
      const eventRow = { id: 'e-1', code: 'JOLL-abc', origin_type: 'organizer', status: 'ACTIVE' };
      const existingStall = { id: 'stall-existing' };

      mockFromSequence([
        // 1. event_vendors check (accepted)
        createSupabaseMock({ data: eventVendorRow, error: null }),
        // 2. events lookup
        createSupabaseMock({ data: eventRow, error: null }),
        // 3. vendor_events duplicate check (found existing stall)
        createSupabaseMock({ data: existingStall, error: null }),
      ]);

      await expect(
        service.createStall('v-1', { eventId: 'e-1' })
      ).rejects.toThrow('Vendor already has a stall at this event');
    });
  });

  describe('listStalls', () => {
    it('returns only organizer-event stalls with booth info', async () => {
      const vendorId = 'v-1';
      const stallRows = [
        {
          id: 'stall-1',
          event_id: 'e-1',
          vendor_id: vendorId,
          qr_code: 'QR1',
          qr_image: 'img1',
          is_direct: false,
          menu_template_id: null,
          created_at: '2026-04-14T00:00:00Z',
          updated_at: '2026-04-14T00:00:00Z',
          events: {
            name: 'Jollof Fest',
            code: 'JOLL-001',
            start_date: '2026-05-01',
            end_date: '2026-05-01',
            status: 'ACTIVE',
            origin_type: 'organizer',
          },
        },
      ];
      const menuConfigs = [{ event_id: 'e-1', booth_info: 'Stall 12' }];

      mockFromSequence([
        // 1. vendor_events select
        createSupabaseMock({ data: stallRows, error: null }),
        // 2. event_menu_configurations select for booth_info
        createSupabaseMock({ data: menuConfigs, error: null }),
      ]);

      const result = await service.listStalls(vendorId);

      expect(result).toHaveLength(1);
      expect(result[0].eventName).toBe('Jollof Fest');
      expect(result[0].boothInfo).toBe('Stall 12');
    });

    it('filters out vendor-created lite events', async () => {
      const vendorId = 'v-1';
      const stallRows = [
        {
          id: 'stall-2',
          event_id: 'e-2',
          vendor_id: vendorId,
          qr_code: 'QR2',
          qr_image: 'img2',
          is_direct: false,
          menu_template_id: null,
          created_at: '2026-04-14T00:00:00Z',
          updated_at: '2026-04-14T00:00:00Z',
          events: {
            name: 'Vendor Pop-up',
            code: 'VPOP-001',
            start_date: '2026-05-01',
            end_date: '2026-05-01',
            status: 'ACTIVE',
            origin_type: 'vendor',
          },
        },
      ];

      mockFromSequence([
        // vendor_events select — row has vendor origin_type, should be filtered out
        createSupabaseMock({ data: stallRows, error: null }),
      ]);

      const result = await service.listStalls(vendorId);

      expect(result).toHaveLength(0);
    });
  });

  describe('deactivateStall', () => {
    it('deletes the vendor_events record and menu config', async () => {
      const vendorId = 'v-1';
      const stallId = 'stall-1';
      const existingStall = { id: stallId, event_id: 'e-1' };

      mockFromSequence([
        // 1. find stall
        createSupabaseMock({ data: existingStall, error: null }),
        // 2. delete vendor_events
        createSupabaseMock({ data: null, error: null }),
        // 3. delete event_menu_configurations
        createSupabaseMock({ data: null, error: null }),
      ]);

      await service.deactivateStall(stallId, vendorId);

      expect(cacheMock.del).toHaveBeenCalledWith('stalls:vendor:v-1');
    });

    it('throws NotFoundError for non-existent stall', async () => {
      mockFromSequence([
        // find stall returns error
        createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'not found' } }),
      ]);

      await expect(
        service.deactivateStall('stall-missing', 'v-1')
      ).rejects.toThrow('Stall not found');
    });
  });

  describe('getStallQR', () => {
    it('returns QR code and image', async () => {
      const qrData = {
        qr_code: 'VENDOR_EVENT:e-1:v-1:sig123',
        qr_image: 'https://storage.test/stall-qr.png',
      };

      mockFromSequence([
        createSupabaseMock({ data: qrData, error: null }),
      ]);

      const result = await service.getStallQR('stall-1', 'v-1');

      expect(result.qrCode).toBe('VENDOR_EVENT:e-1:v-1:sig123');
      expect(result.qrImage).toBe('https://storage.test/stall-qr.png');
    });
  });

  describe('listAvailableEvents', () => {
    it('returns organizer events vendor is accepted into but has no stall for', async () => {
      const vendorId = 'v-1';

      // Two organizer+ACTIVE events the vendor is accepted into
      const eventVendors = [
        {
          event_id: 'e-1',
          events: { id: 'e-1', name: 'Jollof Fest', code: 'JOLL-001', start_date: '2026-05-01', end_date: '2026-05-01', status: 'ACTIVE', origin_type: 'organizer' },
        },
        {
          event_id: 'e-2',
          events: { id: 'e-2', name: 'Suya Night', code: 'SUYA-001', start_date: '2026-06-01', end_date: '2026-06-01', status: 'ACTIVE', origin_type: 'organizer' },
        },
      ];

      // Vendor already has a stall at e-1
      const existingStalls = [{ event_id: 'e-1' }];

      mockFromSequence([
        // 1. event_vendors with joined events
        createSupabaseMock({ data: eventVendors, error: null }),
        // 2. vendor_events check for existing stalls
        createSupabaseMock({ data: existingStalls, error: null }),
      ]);

      const result = await service.listAvailableEvents(vendorId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('e-2');
      expect(result[0].name).toBe('Suya Night');
    });
  });
});
