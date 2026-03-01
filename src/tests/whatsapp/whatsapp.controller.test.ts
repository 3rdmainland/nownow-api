import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../helpers/app.js';

// ── Global fetch mock ────────────────────────────────────────────────────────

function makeFetchResponse(overrides: { ok?: boolean; json?: Record<string, unknown> } = {}) {
  const jsonBody = overrides.json ?? { messages: [{ id: 'wamid.test123' }] };
  return {
    ok: overrides.ok ?? true,
    json: vi.fn().mockResolvedValue(jsonBody),
  };
}

const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse());
(global as any).fetch = mockFetch;

// ── Import controller after fetch is mocked ──────────────────────────────────

import whatsappController from '../../whatsapp/whatsapp.controller.js';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WhatsApp Controller — Integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(makeFetchResponse());

    app = await buildApp(async (fastify) => {
      await fastify.register(whatsappController, { prefix: '/whatsapp' });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /whatsapp/test ──────────────────────────────────────────────────

  describe('POST /whatsapp/test', () => {
    it('returns 201 with { success: true } on successful send', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/test',
        payload: { to: '+27821234567', message: 'Hello test' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('sends correct payload to WhatsApp API (hello_world template)', async () => {
      await app.inject({
        method: 'POST',
        url: '/whatsapp/test',
        payload: { to: '+27821234567', message: 'Hi' },
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/messages');
      const body = JSON.parse(opts.body);
      expect(body.messaging_product).toBe('whatsapp');
      expect(body.to).toBe('+27821234567');
      expect(body.template.name).toBe('hello_world');
    });

    it('returns 400 when "to" is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/test',
        payload: { message: 'Hello' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when "message" is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/test',
        payload: { to: '+27821234567' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/test',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 500 when WhatsApp API returns non-ok response', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse({
        ok: false,
        json: { error: { message: 'Invalid phone number' } },
      }));

      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/test',
        payload: { to: 'bad-number', message: 'Hello' },
      });

      expect(res.statusCode).toBe(500);
    });

    it('returns 500 when fetch throws a network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/test',
        payload: { to: '+27821234567', message: 'Hello' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /whatsapp/order-placed ──────────────────────────────────────────

  describe('POST /whatsapp/order-placed', () => {
    const validPayload = {
      to: '+27821234567',
      orderId: 'order-123',
      total: 'R150.00',
      prepTimeMinutes: 15,
    };

    it('returns 201 with { success: true } on successful send', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-placed',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ success: true });
    });

    it('sends correct template payload to WhatsApp API (place_order)', async () => {
      await app.inject({
        method: 'POST',
        url: '/whatsapp/order-placed',
        payload: validPayload,
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.template.name).toBe('place_order');
      expect(body.template.components).toHaveLength(2); // header + body
      expect(body.template.components[0].type).toBe('header');
      expect(body.template.components[1].type).toBe('body');
      expect(body.template.components[1].parameters).toHaveLength(3);
    });

    it('uses provided qrImageUrl in header when given', async () => {
      await app.inject({
        method: 'POST',
        url: '/whatsapp/order-placed',
        payload: { ...validPayload, qrImageUrl: 'https://storage.test/qr.png' },
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      const headerImage = body.template.components[0].parameters[0].image.link;
      expect(headerImage).toBe('https://storage.test/qr.png');
    });

    it('uses default placeholder image when qrImageUrl is not provided', async () => {
      await app.inject({
        method: 'POST',
        url: '/whatsapp/order-placed',
        payload: validPayload,
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      const headerImage = body.template.components[0].parameters[0].image.link;
      expect(headerImage).toContain('plahold.co');
    });

    it('accepts prepTimeMinutes as a string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-placed',
        payload: { ...validPayload, prepTimeMinutes: '20' },
      });

      expect(res.statusCode).toBe(201);
    });

    it('returns 400 when required fields are missing', async () => {
      // Missing orderId
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-placed',
        payload: { to: '+27821234567', total: 'R100', prepTimeMinutes: 10 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when "to" is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-placed',
        payload: { orderId: 'order-1', total: 'R100', prepTimeMinutes: 10 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 500 when WhatsApp API fails', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse({
        ok: false,
        json: { error: { message: 'Rate limit exceeded' } },
      }));

      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-placed',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toContain('WhatsApp API error');
    });

    it('returns 500 with error message from WhatsApp API', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse({
        ok: false,
        json: { error: { message: 'Template not found' } },
      }));

      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-placed',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toContain('Template not found');
    });
  });

  // ── POST /whatsapp/order-ready ───────────────────────────────────────────

  describe('POST /whatsapp/order-ready', () => {
    const validPayload = {
      to: '+27821234567',
      orderId: 'order-456',
      vendorName: 'Best Burgers',
    };

    it('returns 201 with { success: true } on successful send', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-ready',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ success: true });
    });

    it('sends correct template payload (order_ready_notification)', async () => {
      await app.inject({
        method: 'POST',
        url: '/whatsapp/order-ready',
        payload: validPayload,
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.template.name).toBe('order_ready_notification');
      expect(body.template.components).toHaveLength(1);
      expect(body.template.components[0].parameters).toHaveLength(2);
      expect(body.template.components[0].parameters[0].text).toBe('order-456');
      expect(body.template.components[0].parameters[1].text).toBe('Best Burgers');
    });

    it('returns 400 when "to" is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-ready',
        payload: { orderId: 'order-1', vendorName: 'Test' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when "orderId" is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-ready',
        payload: { to: '+27821234567', vendorName: 'Test' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when "vendorName" is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-ready',
        payload: { to: '+27821234567', orderId: 'order-1' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-ready',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 500 when WhatsApp API returns error', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse({
        ok: false,
        json: { error: { message: 'Forbidden' } },
      }));

      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-ready',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toContain('Forbidden');
    });

    it('returns 500 when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('DNS resolution failed'));

      const res = await app.inject({
        method: 'POST',
        url: '/whatsapp/order-ready',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(500);
    });

    it('sends authorization header with Bearer token', async () => {
      await app.inject({
        method: 'POST',
        url: '/whatsapp/order-ready',
        payload: validPayload,
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Authorization).toMatch(/^Bearer /);
    });
  });
});
