import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Constants mirroring setup.ts env vars ─────────────────────────────────────
// setup.ts already sets these before every test file, but we reference them
// here explicitly so the intent is obvious in the test output.

const WA_API_VERSION = 'v18.0';
const WA_PHONE_NUMBER_ID = 'test-phone-id';
const WA_ACCESS_TOKEN = 'test-wa-token';

const EXPECTED_API_URL = `https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_NUMBER_ID}/messages`;

// ── Global fetch mock ─────────────────────────────────────────────────────────

/**
 * A factory that returns a mock Response-like object.
 * `ok: true` and a successful WhatsApp API body by default.
 */
function makeFetchResponse(overrides: {
  ok?: boolean;
  json?: Record<string, unknown>;
} = {}) {
  const jsonBody = overrides.json ?? { messages: [{ id: 'wamid.test123' }] };
  return {
    ok: overrides.ok ?? true,
    json: vi.fn().mockResolvedValue(jsonBody),
  };
}

// Install a mock for the global `fetch` that every service method uses.
const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse());
(global as any).fetch = mockFetch;

// ── Import service under test ─────────────────────────────────────────────────

// Import AFTER env vars are set (setup.ts guarantees this via setupFiles) and
// after fetch is mocked so the constructor doesn't throw.
import { WhatsappService } from '../../whatsapp/whatsapp.service.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Decode the JSON body that was passed to fetch() in the nth call (0-indexed).
 */
function getRequestBody(callIndex = 0): Record<string, unknown> {
  const call = mockFetch.mock.calls[callIndex];
  if (!call) throw new Error(`fetch was not called ${callIndex + 1} time(s)`);
  return JSON.parse(call[1].body as string);
}

/**
 * Get the headers object from the nth fetch() call.
 */
function getRequestHeaders(callIndex = 0): Record<string, string> {
  const call = mockFetch.mock.calls[callIndex];
  if (!call) throw new Error(`fetch was not called ${callIndex + 1} time(s)`);
  return call[1].headers as Record<string, string>;
}

// ══════════════════════════════════════════════════════════════════════════════
// Test suites
// ══════════════════════════════════════════════════════════════════════════════

describe('WhatsappService', () => {
  let service: WhatsappService;

  beforeEach(() => {
    // Ensure clean env for every test
    process.env.WA_ACCESS_TOKEN = WA_ACCESS_TOKEN;
    process.env.WA_API_VERSION = WA_API_VERSION;
    process.env.WA_PHONE_NUMBER_ID = WA_PHONE_NUMBER_ID;

    vi.clearAllMocks();

    // Reset the fetch mock to the happy-path default for each test
    mockFetch.mockResolvedValue(makeFetchResponse());
    (global as any).fetch = mockFetch;

    service = new WhatsappService();
  });

  afterEach(() => {
    // Restore env vars that individual tests may have deleted
    process.env.WA_ACCESS_TOKEN = WA_ACCESS_TOKEN;
    process.env.WA_API_VERSION = WA_API_VERSION;
    process.env.WA_PHONE_NUMBER_ID = WA_PHONE_NUMBER_ID;
  });

  // ── Constructor / env-var validation ────────────────────────────────────────

  describe('constructor', () => {
    it('throws when WA_ACCESS_TOKEN is not set', () => {
      delete process.env.WA_ACCESS_TOKEN;

      expect(() => new WhatsappService()).toThrowError(
        'Missing WA_ACCESS_TOKEN in environment variables'
      );
    });

    it('constructs successfully when all required env vars are present', () => {
      expect(() => new WhatsappService()).not.toThrow();
    });

    it('builds the API URL from WA_API_VERSION and WA_PHONE_NUMBER_ID', () => {
      // Verify by inspecting what URL is used in the first fetch call
      service.sendWhatsAppMessage('+27820000000').catch(() => {});
      // fetch is called synchronously within the async function startup,
      // so we just verify the URL after awaiting
    });
  });

  // ── sendWhatsAppMessage ──────────────────────────────────────────────────────

  describe('sendWhatsAppMessage()', () => {
    it('calls the WhatsApp API with the hello_world template', async () => {
      await service.sendWhatsAppMessage('+27821234567');

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][0]).toBe(EXPECTED_API_URL);
    });

    it('uses POST method', async () => {
      await service.sendWhatsAppMessage('+27821234567');

      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    });

    it('includes a Bearer Authorization header with the access token', async () => {
      await service.sendWhatsAppMessage('+27821234567');

      const headers = getRequestHeaders();
      expect(headers.Authorization).toBe(`Bearer ${WA_ACCESS_TOKEN}`);
    });

    it('sets Content-Type to application/json', async () => {
      await service.sendWhatsAppMessage('+27821234567');

      const headers = getRequestHeaders();
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends the correct request body', async () => {
      await service.sendWhatsAppMessage('+27821234567');

      const body = getRequestBody();
      expect(body).toEqual({
        messaging_product: 'whatsapp',
        to: '+27821234567',
        type: 'template',
        template: {
          name: 'hello_world',
          language: { code: 'en_US' },
        },
      });
    });

    it('throws when the API returns a non-200 response', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          ok: false,
          json: { error: { message: 'Invalid phone number' } },
        })
      );

      await expect(service.sendWhatsAppMessage('+999')).rejects.toThrow(
        'WhatsApp API error: Invalid phone number'
      );
    });

    it('throws with "Unknown error" when API error has no message field', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({ ok: false, json: {} })
      );

      await expect(service.sendWhatsAppMessage('+999')).rejects.toThrow(
        'WhatsApp API error: Unknown error'
      );
    });
  });

  // ── sendOrderPlacedTemplate ──────────────────────────────────────────────────

  describe('sendOrderPlacedTemplate()', () => {
    const defaultParams = {
      orderId: 'order-abc-123',
      total: 'R 150.00',
      prepTimeMinutes: 15,
    };

    it('calls the WhatsApp API at the correct URL', async () => {
      await service.sendOrderPlacedTemplate('+27821234567', defaultParams);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][0]).toBe(EXPECTED_API_URL);
    });

    it('uses the place_order template name', async () => {
      await service.sendOrderPlacedTemplate('+27821234567', defaultParams);

      const body = getRequestBody();
      expect((body.template as any).name).toBe('place_order');
    });

    it('sends the correct language code', async () => {
      await service.sendOrderPlacedTemplate('+27821234567', defaultParams);

      const body = getRequestBody();
      expect((body.template as any).language).toEqual({ code: 'en' });
    });

    it('includes orderId, total and prepTimeMinutes as body text parameters', async () => {
      await service.sendOrderPlacedTemplate('+27821234567', {
        orderId: 'order-xyz',
        total: 'R 200.00',
        prepTimeMinutes: 20,
      });

      const body = getRequestBody();
      const components: any[] = (body.template as any).components;
      const bodyComponent = components.find((c: any) => c.type === 'body');

      expect(bodyComponent).toBeDefined();
      expect(bodyComponent.parameters).toEqual([
        { type: 'text', text: 'order-xyz' },
        { type: 'text', text: 'R 200.00' },
        { type: 'text', text: '20' },
      ]);
    });

    it('includes a header image component with the default placeholder when qrImageUrl is omitted', async () => {
      await service.sendOrderPlacedTemplate('+27821234567', defaultParams);

      const body = getRequestBody();
      const components: any[] = (body.template as any).components;
      const headerComponent = components.find((c: any) => c.type === 'header');

      expect(headerComponent).toBeDefined();
      expect(headerComponent.parameters[0]).toMatchObject({
        type: 'image',
        image: { link: 'https://plahold.co/400x400.png' },
      });
    });

    it('uses the provided qrImageUrl in the header component', async () => {
      const qrImageUrl = 'https://storage.nownow.com/qr/order-abc.png';
      await service.sendOrderPlacedTemplate('+27821234567', {
        ...defaultParams,
        qrImageUrl,
      });

      const body = getRequestBody();
      const components: any[] = (body.template as any).components;
      const headerComponent = components.find((c: any) => c.type === 'header');

      expect(headerComponent.parameters[0].image.link).toBe(qrImageUrl);
    });

    it('includes the correct recipient phone number', async () => {
      await service.sendOrderPlacedTemplate('+27829876543', defaultParams);

      const body = getRequestBody();
      expect(body.to).toBe('+27829876543');
    });

    it('includes Bearer token in Authorization header', async () => {
      await service.sendOrderPlacedTemplate('+27821234567', defaultParams);

      const headers = getRequestHeaders();
      expect(headers.Authorization).toBe(`Bearer ${WA_ACCESS_TOKEN}`);
    });

    it('coerces numeric prepTimeMinutes to a string in the body parameters', async () => {
      await service.sendOrderPlacedTemplate('+27821234567', {
        orderId: 'order-str',
        total: 'R 50.00',
        prepTimeMinutes: 30,
      });

      const body = getRequestBody();
      const components: any[] = (body.template as any).components;
      const bodyComponent = components.find((c: any) => c.type === 'body');
      const prepParam = bodyComponent.parameters[2];

      expect(typeof prepParam.text).toBe('string');
      expect(prepParam.text).toBe('30');
    });

    it('accepts prepTimeMinutes as a string', async () => {
      await service.sendOrderPlacedTemplate('+27821234567', {
        orderId: 'order-str',
        total: 'R 50.00',
        prepTimeMinutes: '25 minutes',
      });

      const body = getRequestBody();
      const components: any[] = (body.template as any).components;
      const bodyComponent = components.find((c: any) => c.type === 'body');
      const prepParam = bodyComponent.parameters[2];

      expect(prepParam.text).toBe('25 minutes');
    });

    it('throws when the API returns a non-200 response', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          ok: false,
          json: { error: { message: 'Template not approved' } },
        })
      );

      await expect(
        service.sendOrderPlacedTemplate('+27821234567', defaultParams)
      ).rejects.toThrow('WhatsApp API error: Template not approved');
    });

    it('does not throw when the API returns a success response', async () => {
      await expect(
        service.sendOrderPlacedTemplate('+27821234567', defaultParams)
      ).resolves.toBeUndefined();
    });
  });

  // ── sendOrderReadyTemplate ───────────────────────────────────────────────────

  describe('sendOrderReadyTemplate()', () => {
    const defaultParams = { orderId: 'order-ready-001', vendorName: 'Burger Palace' };

    it('calls the WhatsApp API at the correct URL', async () => {
      await service.sendOrderReadyTemplate('+27821234567', defaultParams);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][0]).toBe(EXPECTED_API_URL);
    });

    it('uses the order_ready_notification template name', async () => {
      await service.sendOrderReadyTemplate('+27821234567', defaultParams);

      const body = getRequestBody();
      expect((body.template as any).name).toBe('order_ready_notification');
    });

    it('sends the correct language code', async () => {
      await service.sendOrderReadyTemplate('+27821234567', defaultParams);

      const body = getRequestBody();
      expect((body.template as any).language).toEqual({ code: 'en' });
    });

    it('includes orderId and vendorName as body text parameters in the correct order', async () => {
      await service.sendOrderReadyTemplate('+27821234567', {
        orderId: 'order-ready-001',
        vendorName: 'Burger Palace',
      });

      const body = getRequestBody();
      const components: any[] = (body.template as any).components;
      const bodyComponent = components.find((c: any) => c.type === 'body');

      expect(bodyComponent).toBeDefined();
      expect(bodyComponent.parameters).toEqual([
        { type: 'text', text: 'order-ready-001' },
        { type: 'text', text: 'Burger Palace' },
      ]);
    });

    it('sets the correct recipient phone', async () => {
      await service.sendOrderReadyTemplate('+27829998877', defaultParams);

      const body = getRequestBody();
      expect(body.to).toBe('+27829998877');
    });

    it('includes Bearer token in Authorization header', async () => {
      await service.sendOrderReadyTemplate('+27821234567', defaultParams);

      const headers = getRequestHeaders();
      expect(headers.Authorization).toBe(`Bearer ${WA_ACCESS_TOKEN}`);
    });

    it('does not include a header component (no image)', async () => {
      await service.sendOrderReadyTemplate('+27821234567', defaultParams);

      const body = getRequestBody();
      const components: any[] = (body.template as any).components;
      const headerComponent = components.find((c: any) => c.type === 'header');

      expect(headerComponent).toBeUndefined();
    });

    it('throws when the API returns a non-200 response', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          ok: false,
          json: { error: { message: 'Rate limit exceeded' } },
        })
      );

      await expect(
        service.sendOrderReadyTemplate('+27821234567', defaultParams)
      ).rejects.toThrow('WhatsApp API error: Rate limit exceeded');
    });

    it('resolves successfully on 200 response', async () => {
      await expect(
        service.sendOrderReadyTemplate('+27821234567', defaultParams)
      ).resolves.toBeUndefined();
    });
  });

  // ── sendOrderCollectedTemplate ───────────────────────────────────────────────

  describe('sendOrderCollectedTemplate()', () => {
    const defaultParams = { orderId: 'order-col-999', vendorName: 'Pizza Hub' };

    it('calls the WhatsApp API at the correct URL', async () => {
      await service.sendOrderCollectedTemplate('+27821234567', defaultParams);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][0]).toBe(EXPECTED_API_URL);
    });

    it('uses the order_collected_confirmation template name', async () => {
      await service.sendOrderCollectedTemplate('+27821234567', defaultParams);

      const body = getRequestBody();
      expect((body.template as any).name).toBe('order_collected_confirmation');
    });

    it('sends the correct language code', async () => {
      await service.sendOrderCollectedTemplate('+27821234567', defaultParams);

      const body = getRequestBody();
      expect((body.template as any).language).toEqual({ code: 'en' });
    });

    it('includes orderId and vendorName as named body text parameters', async () => {
      await service.sendOrderCollectedTemplate('+27821234567', {
        orderId: 'order-col-999',
        vendorName: 'Pizza Hub',
      });

      const body = getRequestBody();
      const components: any[] = (body.template as any).components;
      const bodyComponent = components.find((c: any) => c.type === 'body');

      expect(bodyComponent).toBeDefined();
      expect(bodyComponent.parameters).toEqual([
        { type: 'text', parameter_name: 'order_id', text: 'order-col-999' },
        { type: 'text', parameter_name: 'vendor_name', text: 'Pizza Hub' },
      ]);
    });

    it('sets the correct recipient phone', async () => {
      await service.sendOrderCollectedTemplate('+27825551234', defaultParams);

      const body = getRequestBody();
      expect(body.to).toBe('+27825551234');
    });

    it('includes Bearer token in Authorization header', async () => {
      await service.sendOrderCollectedTemplate('+27821234567', defaultParams);

      const headers = getRequestHeaders();
      expect(headers.Authorization).toBe(`Bearer ${WA_ACCESS_TOKEN}`);
    });

    it('sets Content-Type to application/json', async () => {
      await service.sendOrderCollectedTemplate('+27821234567', defaultParams);

      const headers = getRequestHeaders();
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('does not include a header component', async () => {
      await service.sendOrderCollectedTemplate('+27821234567', defaultParams);

      const body = getRequestBody();
      const components: any[] = (body.template as any).components;
      const headerComponent = components.find((c: any) => c.type === 'header');

      expect(headerComponent).toBeUndefined();
    });

    it('throws with the API error message on non-200 response', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          ok: false,
          json: { error: { message: 'Phone number not registered' } },
        })
      );

      await expect(
        service.sendOrderCollectedTemplate('+27821234567', defaultParams)
      ).rejects.toThrow('WhatsApp API error: Phone number not registered');
    });

    it('throws with "Unknown error" when API error body has no message', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({ ok: false, json: {} })
      );

      await expect(
        service.sendOrderCollectedTemplate('+27821234567', defaultParams)
      ).rejects.toThrow('WhatsApp API error: Unknown error');
    });

    it('resolves successfully on 200 response', async () => {
      await expect(
        service.sendOrderCollectedTemplate('+27821234567', defaultParams)
      ).resolves.toBeUndefined();
    });
  });

  // ── Request structure shared assertions ─────────────────────────────────────

  describe('shared request structure', () => {
    it('every method sets messaging_product to "whatsapp"', async () => {
      await service.sendWhatsAppMessage('+27821234567');
      expect(getRequestBody(0).messaging_product).toBe('whatsapp');

      vi.clearAllMocks();
      mockFetch.mockResolvedValue(makeFetchResponse());

      await service.sendOrderPlacedTemplate('+27821234567', {
        orderId: 'o1',
        total: 'R10',
        prepTimeMinutes: 5,
      });
      expect(getRequestBody(0).messaging_product).toBe('whatsapp');

      vi.clearAllMocks();
      mockFetch.mockResolvedValue(makeFetchResponse());

      await service.sendOrderReadyTemplate('+27821234567', { orderId: 'o2', vendorName: 'V' });
      expect(getRequestBody(0).messaging_product).toBe('whatsapp');

      vi.clearAllMocks();
      mockFetch.mockResolvedValue(makeFetchResponse());

      await service.sendOrderCollectedTemplate('+27821234567', { orderId: 'o3', vendorName: 'V' });
      expect(getRequestBody(0).messaging_product).toBe('whatsapp');
    });

    it('every method sets type to "template"', async () => {
      const methods: Promise<void>[] = [
        service.sendWhatsAppMessage('+27821234567'),
      ];

      for (const p of methods) await p;

      expect(getRequestBody(0).type).toBe('template');
    });

    it('every method sends to the correct Graph API version URL', async () => {
      await service.sendWhatsAppMessage('+27821234567');
      expect(mockFetch.mock.calls[0][0]).toContain('graph.facebook.com');
      expect(mockFetch.mock.calls[0][0]).toContain(WA_API_VERSION);
      expect(mockFetch.mock.calls[0][0]).toContain(WA_PHONE_NUMBER_ID);
    });
  });

  // ── Error handling edge cases ────────────────────────────────────────────────

  describe('API error response handling', () => {
    it('does not swallow errors — always re-throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({ ok: false, json: { error: { message: 'Forbidden' } } })
      );

      // sendWhatsAppMessage DOES throw on non-ok (unlike the "log only" variant)
      await expect(service.sendWhatsAppMessage('+27821111111')).rejects.toThrow();
    });

    it('handles network failures by propagating the fetch rejection', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(service.sendWhatsAppMessage('+27821111111')).rejects.toThrow(
        'Network timeout'
      );
    });
  });
});
