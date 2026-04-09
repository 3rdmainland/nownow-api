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

import { VendorEventService } from '../../vendor-event/vendor-event.service.js';

function mockFromSequence(responses: ReturnType<typeof createSupabaseMock>[]) {
  let i = 0;
  supabaseMock.from.mockImplementation(() => {
    const mock = responses[i] ?? createSupabaseMock({ data: null, error: null });
    i++;
    return mock;
  });
}

describe('VendorEventService', () => {
  let service: VendorEventService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new VendorEventService();
  });

  describe('createVendorEvent', () => {
    it('creates an event, event_vendors row, event_menu_config, and vendor_events row', async () => {
      const vendorId = 'v-1';
      const vendor = { id: vendorId, name: 'Test Truck', vendor_tier: 'lite' };
      const createdEvent = { id: 'e-1', code: 'TEST-abc', name: 'Test Truck Pop-up', start_date: '2026-04-10', end_date: '2026-04-10', status: 'ACTIVE', origin_type: 'vendor' };
      const vendorEventRow = { id: 've-1', event_id: 'e-1', vendor_id: vendorId, qr_code: 'VENDOR_EVENT:e-1:v-1:sig', qr_image: 'https://storage.test/qr.png', menu_template_id: null, is_direct: false, created_at: '2026-04-10', updated_at: '2026-04-10' };

      mockFromSequence([
        createSupabaseMock({ data: vendor, error: null }),
        createSupabaseMock({ data: createdEvent, error: null }),
        createSupabaseMock({ data: null, error: null }),
        createSupabaseMock({ data: null, error: null }),
        createSupabaseMock({ data: vendorEventRow, error: null }),
      ]);

      const result = await service.createVendorEvent(vendorId, {
        name: 'Test Truck Pop-up',
        startDate: '2026-04-10T08:00:00Z',
        endDate: '2026-04-10T18:00:00Z',
      });

      expect(result.eventId).toBe('e-1');
      expect(result.qrImage).toBe('https://storage.test/qr.png');
    });

    it('throws when vendor tier is not lite', async () => {
      const vendor = { id: 'v-1', name: 'Test', vendor_tier: 'standard' };
      mockFromSequence([
        createSupabaseMock({ data: vendor, error: null }),
      ]);

      await expect(
        service.createVendorEvent('v-1', { name: 'X', startDate: '2026-04-10', endDate: '2026-04-10' })
      ).rejects.toThrow();
    });
  });

  describe('getOrCreateDirectQR', () => {
    it('returns existing direct QR if one exists', async () => {
      const existing = { id: 've-1', event_id: 'e-1', vendor_id: 'v-1', qr_code: 'VENDOR_DIRECT:v-1:sig', qr_image: 'https://storage.test/qr.png', is_direct: true, menu_template_id: null, created_at: '2026-04-10', updated_at: '2026-04-10' };
      mockFromSequence([
        createSupabaseMock({ data: { id: 'v-1', vendor_tier: 'lite', name: 'Test' }, error: null }),
        createSupabaseMock({ data: existing, error: null }),
      ]);

      const result = await service.getOrCreateDirectQR('v-1');
      expect(result.qrCode).toBe('VENDOR_DIRECT:v-1:sig');
    });

    it('creates a new direct QR when none exists', async () => {
      const vendorId = 'v-2';
      const vendor = { id: vendorId, name: 'Fresh Eats', vendor_tier: 'lite' };
      const createdEvent = {
        id: 'e-2', code: 'FRES-xyz', name: 'Fresh Eats - Direct',
        start_date: '2026-04-09T00:00:00Z', end_date: '2099-12-31T23:59:59Z',
        status: 'ACTIVE', origin_type: 'vendor_direct', is_public: false,
        location: {}, timezone: 'UTC', created_at: '2026-04-09', updated_at: '2026-04-09',
      };
      const vendorEventRow = {
        id: 've-2', event_id: 'e-2', vendor_id: vendorId,
        qr_code: 'VENDOR_DIRECT:vid:sig456', qr_image: 'https://storage.test/qr.png',
        menu_template_id: null, is_direct: true,
        created_at: '2026-04-09', updated_at: '2026-04-09',
      };

      mockFromSequence([
        // 1. assertCanCreateEvents -> vendors select
        createSupabaseMock({ data: vendor, error: null }),
        // 2. check existing -> vendor_events select (none found)
        createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'not found' } }),
        // 3. events insert
        createSupabaseMock({ data: createdEvent, error: null }),
        // 4. event_vendors insert
        createSupabaseMock({ data: null, error: null }),
        // 5. event_menu_configurations insert
        createSupabaseMock({ data: null, error: null }),
        // 6. vendor_events insert
        createSupabaseMock({ data: vendorEventRow, error: null }),
      ]);

      const result = await service.getOrCreateDirectQR(vendorId);
      expect(result.id).toBe('ve-2');
      expect(result.isDirect).toBe(true);
      expect(result.qrImage).toBe('https://storage.test/qr.png');
      expect(result.eventName).toBe('Fresh Eats - Direct');
      expect(result.eventCode).toBe('FRES-xyz');
      expect(result.status).toBe('ACTIVE');
    });
  });

  describe('listVendorEvents', () => {
    it('returns vendor events with event details', async () => {
      const rows = [
        {
          id: 've-1', event_id: 'e-1', vendor_id: 'v-1', qr_code: 'QR1', qr_image: 'img1', is_direct: false, menu_template_id: null,
          created_at: '2026-04-10', updated_at: '2026-04-10',
          events: { name: 'Pop-up', code: 'PP1', start_date: '2026-04-10', end_date: '2026-04-10', status: 'ACTIVE' },
        },
      ];
      mockFromSequence([
        createSupabaseMock({ data: rows, error: null }),
      ]);

      const result = await service.listVendorEvents('v-1');
      expect(result).toHaveLength(1);
      expect(result[0].eventName).toBe('Pop-up');
    });
  });
});
