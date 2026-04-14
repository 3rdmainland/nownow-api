# Vendor Stalls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/stalls` API surface that lets vendors create stalls linked to organizer events they've been invited to, with each stall getting its own QR code and menu config. Reuses the existing `vendor_events` table — no DB migration needed.

**Architecture:** New `src/stall/` module (controller, service, types, schema, utils) that queries the same `vendor_events`, `events`, `event_vendors`, and `event_menu_configurations` tables. Stalls are `vendor_events` records where `is_direct = false` and the linked event has `origin_type = 'organizer'`. The existing vendor-event module stays untouched — vendor_direct (permanent storefront) and vendor-created lite events continue working as before.

**Tech Stack:** Fastify, Supabase (PostgREST), Redis caching, QRHelper (HMAC-signed QR codes), vitest for tests.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/stall/stall.types.ts` | Stall and CreateStallPayload interfaces |
| Create | `src/stall/stall.schema.ts` | Fastify JSON schema definitions for all stall endpoints |
| Create | `src/stall/stall.utils.ts` | DB row → Stall type mappers |
| Create | `src/stall/stall.service.ts` | Business logic: create stall, list stalls, get/update/deactivate stall, get stall QR, update stall menu |
| Create | `src/stall/stall.controller.ts` | Fastify route handlers mounted at `/stalls` |
| Modify | `src/index.ts:38,193` | Import and register stall controller |
| Create | `src/tests/stall/stall.service.test.ts` | Unit tests for StallService |

---

### Task 1: Types, Utils, and Schemas

**Files:**
- Create: `src/stall/stall.types.ts`
- Create: `src/stall/stall.utils.ts`
- Create: `src/stall/stall.schema.ts`

- [ ] **Step 1: Create stall types**

```typescript
// src/stall/stall.types.ts

export interface Stall {
  id: string;
  eventId: string;
  vendorId: string;
  qrCode: string;
  qrImage: string;
  menuTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StallWithDetails extends Stall {
  eventName: string;
  eventCode: string;
  startDate: string;
  endDate: string;
  eventStatus: string;
  boothInfo: string | null;
}

export interface CreateStallPayload {
  eventId: string;
  menuTemplateId?: string;
  allowPayAtStall?: boolean;
  boothInfo?: string;
}
```

- [ ] **Step 2: Create stall utils (DB mappers)**

```typescript
// src/stall/stall.utils.ts

import { Stall, StallWithDetails } from './stall.types.js';

export function fromDbStall(row: any): Stall {
  return {
    id: row.id,
    eventId: row.event_id,
    vendorId: row.vendor_id,
    qrCode: row.qr_code,
    qrImage: row.qr_image,
    menuTemplateId: row.menu_template_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function fromDbStallWithDetails(row: any): StallWithDetails {
  return {
    ...fromDbStall(row),
    eventName: row.events?.name ?? '',
    eventCode: row.events?.code ?? '',
    startDate: row.events?.start_date ?? '',
    endDate: row.events?.end_date ?? '',
    eventStatus: row.events?.status ?? 'ACTIVE',
    boothInfo: row.booth_info ?? null,
  };
}
```

- [ ] **Step 3: Create stall schemas**

```typescript
// src/stall/stall.schema.ts

const stallResponseProperties = {
  id: { type: 'string' },
  eventId: { type: 'string' },
  vendorId: { type: 'string' },
  qrCode: { type: 'string' },
  qrImage: { type: 'string' },
  menuTemplateId: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
};

const stallWithDetailsProperties = {
  ...stallResponseProperties,
  eventName: { type: 'string' },
  eventCode: { type: 'string' },
  startDate: { type: 'string' },
  endDate: { type: 'string' },
  eventStatus: { type: 'string' },
  boothInfo: { type: ['string', 'null'] },
};

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const createStallSchema = {
  description: 'Create a stall at an organizer event the vendor was invited to',
  tags: ['stalls'],
  body: {
    type: 'object',
    properties: {
      eventId: { type: 'string' },
      menuTemplateId: { type: 'string' },
      allowPayAtStall: { type: 'boolean' },
      boothInfo: { type: 'string', maxLength: 255 },
    },
    required: ['eventId'],
  },
  response: {
    201: {
      type: 'object',
      properties: { stall: { type: 'object', properties: stallResponseProperties } },
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    500: errorResponse,
  },
};

export const listStallsSchema = {
  description: 'List all stalls for this vendor',
  tags: ['stalls'],
  response: {
    200: {
      type: 'object',
      properties: {
        stalls: {
          type: 'array',
          items: { type: 'object', properties: stallWithDetailsProperties },
        },
      },
    },
    500: errorResponse,
  },
};

export const getStallSchema = {
  description: 'Get a specific stall by ID',
  tags: ['stalls'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  response: {
    200: {
      type: 'object',
      properties: { stall: { type: 'object', properties: stallWithDetailsProperties } },
    },
    404: errorResponse,
    500: errorResponse,
  },
};

export const updateStallSchema = {
  description: 'Update a stall (menu template, booth info)',
  tags: ['stalls'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  body: {
    type: 'object',
    properties: {
      menuTemplateId: { type: ['string', 'null'] },
      boothInfo: { type: ['string', 'null'], maxLength: 255 },
      allowPayAtStall: { type: 'boolean' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: { stall: { type: 'object', properties: stallWithDetailsProperties } },
    },
    404: errorResponse,
    500: errorResponse,
  },
};

export const deleteStallSchema = {
  description: 'Remove a stall (deactivate)',
  tags: ['stalls'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  response: {
    204: { type: 'null' },
    404: errorResponse,
    500: errorResponse,
  },
};

export const getStallQRSchema = {
  description: 'Re-download QR code for a stall',
  tags: ['stalls'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  response: {
    200: {
      type: 'object',
      properties: {
        qrCode: { type: 'string' },
        qrImage: { type: 'string' },
      },
    },
    404: errorResponse,
    500: errorResponse,
  },
};

export const listInvitedEventsSchema = {
  description: 'List organizer events this vendor has been invited to (accepted) but has not yet created a stall for',
  tags: ['stalls'],
  response: {
    200: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              code: { type: 'string' },
              startDate: { type: 'string' },
              endDate: { type: 'string' },
              status: { type: 'string' },
            },
          },
        },
      },
    },
    500: errorResponse,
  },
};
```

- [ ] **Step 4: Commit**

```bash
git add src/stall/stall.types.ts src/stall/stall.utils.ts src/stall/stall.schema.ts
git commit -m "feat(stalls): add types, utils, and JSON schemas for stall endpoints"
```

---

### Task 2: Stall Service

**Files:**
- Create: `src/stall/stall.service.ts`

- [ ] **Step 1: Write the StallService**

```typescript
// src/stall/stall.service.ts

import { supabase } from '../lib/supabase.js';
import { cache } from '../lib/redis.js';
import { QRHelper } from '../lib/qr.helper.js';
import { ForbiddenError, ValidationError, NotFoundError, ConflictError } from '../lib/errors.js';
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

  /**
   * List organizer events the vendor has accepted but not yet created a stall for.
   */
  async listAvailableEvents(vendorId: string): Promise<any[]> {
    // 1. Get all events the vendor is accepted into (organizer-created only)
    const { data: acceptedRows, error: acceptedError } = await supabase
      .from('event_vendors')
      .select('event_id')
      .eq('vendor_id', vendorId)
      .eq('status', 'accepted');

    if (acceptedError) throw new Error(`Failed to fetch accepted events: ${acceptedError.message}`);
    if (!acceptedRows || acceptedRows.length === 0) return [];

    const acceptedEventIds = acceptedRows.map((r: any) => r.event_id);

    // 2. Filter to organizer-origin, ACTIVE events
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, name, code, start_date, end_date, status')
      .in('id', acceptedEventIds)
      .eq('origin_type', 'organizer')
      .eq('status', 'ACTIVE');

    if (eventsError) throw new Error(`Failed to fetch events: ${eventsError.message}`);
    if (!events || events.length === 0) return [];

    // 3. Exclude events the vendor already has a stall for
    const { data: existingStalls, error: stallError } = await supabase
      .from('vendor_events')
      .select('event_id')
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .in('event_id', events.map((e: any) => e.id));

    if (stallError) throw new Error(`Failed to check existing stalls: ${stallError.message}`);

    const existingEventIds = new Set((existingStalls || []).map((s: any) => s.event_id));

    return events
      .filter((e: any) => !existingEventIds.has(e.id))
      .map((e: any) => ({
        id: e.id,
        name: e.name,
        code: e.code,
        startDate: e.start_date,
        endDate: e.end_date,
        status: e.status,
      }));
  }

  /**
   * Create a stall at an organizer event the vendor was invited to.
   */
  async createStall(vendorId: string, payload: CreateStallPayload): Promise<Stall> {
    // 1. Verify the vendor is accepted into this organizer event
    const { data: junction, error: junctionError } = await supabase
      .from('event_vendors')
      .select('event_id')
      .eq('vendor_id', vendorId)
      .eq('event_id', payload.eventId)
      .eq('status', 'accepted')
      .single();

    if (junctionError || !junction) {
      throw new ForbiddenError('Vendor is not accepted into this event');
    }

    // 2. Verify the event is organizer-created and ACTIVE
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, name, code, origin_type, status')
      .eq('id', payload.eventId)
      .single();

    if (eventError || !event) throw new NotFoundError('Event not found');
    if (event.origin_type !== 'organizer') throw new ValidationError('Stalls can only be created at organizer events');
    if (event.status !== 'ACTIVE') throw new ValidationError('Event is not active');

    // 3. Check vendor doesn't already have a stall at this event
    const { data: existing } = await supabase
      .from('vendor_events')
      .select('id')
      .eq('vendor_id', vendorId)
      .eq('event_id', payload.eventId)
      .eq('is_direct', false)
      .single();

    if (existing) throw new ConflictError('Vendor already has a stall at this event');

    // 4. Create event_menu_configurations entry for this stall
    const menuConfig: Record<string, any> = {
      event_id: payload.eventId,
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
    if (payload.boothInfo) {
      menuConfig.booth_info = payload.boothInfo;
    }

    const { error: menuError } = await supabase
      .from('event_menu_configurations')
      .insert([menuConfig]);

    if (menuError) throw new Error(`Failed to create menu config: ${menuError.message}`);

    // 5. Generate QR code (reuses VENDOR_EVENT format)
    const qrString = this.qrHelper.generateVendorEventQR(payload.eventId, vendorId);
    const customerUrl = `${CUSTOMER_APP_URL}/e/${event.code}/v/${vendorId}`;
    const qrBuffer = await this.qrHelper.generateQRCodeBuffer(customerUrl);
    const qrImageUrl = await this.qrHelper.uploadVendorEventQRImage(qrBuffer, `stall-${payload.eventId}-${vendorId}`);

    // 6. Create vendor_events record (this IS the stall record)
    const { data: stallRow, error: stallError } = await supabase
      .from('vendor_events')
      .insert({
        event_id: payload.eventId,
        vendor_id: vendorId,
        qr_code: qrString,
        qr_image: qrImageUrl,
        menu_template_id: payload.menuTemplateId || null,
        is_direct: false,
      })
      .select()
      .single();

    if (stallError) throw new Error(`Failed to create stall: ${stallError.message}`);

    await cache.del(stallCacheKeys.byVendor(vendorId));

    return fromDbStall(stallRow);
  }

  /**
   * List all stalls for a vendor (vendor_events where is_direct=false
   * and the linked event is origin_type='organizer').
   */
  async listStalls(vendorId: string): Promise<StallWithDetails[]> {
    const { data, error } = await supabase
      .from('vendor_events')
      .select('*, events(name, code, start_date, end_date, status, origin_type)')
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to list stalls: ${error.message}`);

    // Filter to organizer events only (exclude vendor-created lite events)
    const stalls = (data || []).filter((row: any) => row.events?.origin_type === 'organizer');

    // Enrich with booth_info from event_menu_configurations
    if (stalls.length > 0) {
      const eventIds = stalls.map((s: any) => s.event_id);
      const { data: configs } = await supabase
        .from('event_menu_configurations')
        .select('event_id, vendor_id, booth_info')
        .eq('vendor_id', vendorId)
        .in('event_id', eventIds);

      const boothMap = new Map<string, string>();
      (configs || []).forEach((c: any) => {
        if (c.booth_info) boothMap.set(c.event_id, c.booth_info);
      });

      return stalls.map((row: any) => {
        row.booth_info = boothMap.get(row.event_id) ?? null;
        return fromDbStallWithDetails(row);
      });
    }

    return [];
  }

  /**
   * Get a single stall by ID.
   */
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

    // Get booth_info
    const { data: config } = await supabase
      .from('event_menu_configurations')
      .select('booth_info')
      .eq('event_id', data.event_id)
      .eq('vendor_id', vendorId)
      .single();

    data.booth_info = config?.booth_info ?? null;

    return fromDbStallWithDetails(data);
  }

  /**
   * Update stall settings (menu template, booth info, pay-at-stall).
   */
  async updateStall(
    id: string,
    vendorId: string,
    updates: { menuTemplateId?: string | null; boothInfo?: string | null; allowPayAtStall?: boolean }
  ): Promise<StallWithDetails> {
    // Verify stall exists and belongs to vendor
    const { data: stall, error: stallError } = await supabase
      .from('vendor_events')
      .select('id, event_id')
      .eq('id', id)
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .single();

    if (stallError || !stall) throw new NotFoundError('Stall not found');

    // Update vendor_events if menu template changed
    if (updates.menuTemplateId !== undefined) {
      await supabase
        .from('vendor_events')
        .update({ menu_template_id: updates.menuTemplateId })
        .eq('id', id);
    }

    // Update event_menu_configurations for booth_info and allowPayAtStall
    const configUpdates: Record<string, any> = {};
    if (updates.boothInfo !== undefined) configUpdates.booth_info = updates.boothInfo;
    if (updates.allowPayAtStall !== undefined) configUpdates.allow_pay_at_stall = updates.allowPayAtStall;
    if (updates.menuTemplateId !== undefined) configUpdates.template_id = updates.menuTemplateId;

    if (Object.keys(configUpdates).length > 0) {
      await supabase
        .from('event_menu_configurations')
        .update(configUpdates)
        .eq('event_id', stall.event_id)
        .eq('vendor_id', vendorId);
    }

    await cache.del(stallCacheKeys.byVendor(vendorId));

    return this.getStall(id, vendorId);
  }

  /**
   * Deactivate a stall. Does NOT cancel the event — just removes the vendor_events record.
   * The vendor's event_vendors junction (their acceptance of the invite) stays intact.
   */
  async deactivateStall(id: string, vendorId: string): Promise<void> {
    const { data: stall, error: stallError } = await supabase
      .from('vendor_events')
      .select('id, event_id')
      .eq('id', id)
      .eq('vendor_id', vendorId)
      .eq('is_direct', false)
      .single();

    if (stallError || !stall) throw new NotFoundError('Stall not found');

    // Delete the vendor_events record (the stall)
    await supabase
      .from('vendor_events')
      .delete()
      .eq('id', id);

    // Delete the associated menu config
    await supabase
      .from('event_menu_configurations')
      .delete()
      .eq('event_id', stall.event_id)
      .eq('vendor_id', vendorId);

    await cache.del(stallCacheKeys.byVendor(vendorId));
  }

  /**
   * Re-download QR code for a stall.
   */
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
```

- [ ] **Step 2: Commit**

```bash
git add src/stall/stall.service.ts
git commit -m "feat(stalls): add StallService with create, list, get, update, deactivate, QR"
```

---

### Task 3: Stall Controller and Route Registration

**Files:**
- Create: `src/stall/stall.controller.ts`
- Modify: `src/index.ts:38,193`

- [ ] **Step 1: Create stall controller**

```typescript
// src/stall/stall.controller.ts

import { FastifyPluginAsync } from 'fastify';
import { StallService } from './stall.service.js';
import {
  createStallSchema,
  listStallsSchema,
  getStallSchema,
  updateStallSchema,
  deleteStallSchema,
  getStallQRSchema,
  listInvitedEventsSchema,
} from './stall.schema.js';

const stallController: FastifyPluginAsync = async (fastify) => {
  const service = new StallService();

  async function getVendorId(request: any, reply: any): Promise<string> {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Authentication required' });
      throw new Error('Unauthorized');
    }
    const user = request.user as { vendorId?: string; role?: string };
    if (user?.role !== 'vendor' || !user.vendorId) {
      reply.status(401).send({ error: 'Vendor authentication required' });
      throw new Error('Unauthorized');
    }
    return user.vendorId;
  }

  // GET /stalls/available-events — list organizer events vendor can create stalls for
  fastify.get('/available-events', { schema: listInvitedEventsSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const events = await service.listAvailableEvents(vendorId);
      return { events };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /stalls — create a stall at an organizer event
  fastify.post('/', { schema: createStallSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const payload = request.body as { eventId: string; menuTemplateId?: string; allowPayAtStall?: boolean; boothInfo?: string };
      const stall = await service.createStall(vendorId, payload);
      return reply.status(201).send({ stall });
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 403) return reply.status(403).send({ error: err.message });
      if (err.statusCode === 400) return reply.status(400).send({ error: err.message });
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      if (err.statusCode === 409) return reply.status(409).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /stalls — list vendor's stalls
  fastify.get('/', { schema: listStallsSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const stalls = await service.listStalls(vendorId);
      return { stalls };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /stalls/:id — get a specific stall
  fastify.get<{ Params: { id: string } }>('/:id', { schema: getStallSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const stall = await service.getStall(request.params.id, vendorId);
      return { stall };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /stalls/:id — update stall settings
  fastify.patch<{ Params: { id: string } }>('/:id', { schema: updateStallSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      const updates = request.body as { menuTemplateId?: string | null; boothInfo?: string | null; allowPayAtStall?: boolean };
      const stall = await service.updateStall(request.params.id, vendorId, updates);
      return { stall };
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // DELETE /stalls/:id — remove a stall
  fastify.delete<{ Params: { id: string } }>('/:id', { schema: deleteStallSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      await service.deactivateStall(request.params.id, vendorId);
      return reply.status(204).send();
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /stalls/:id/qr — re-download QR code
  fastify.get<{ Params: { id: string } }>('/:id/qr', { schema: getStallQRSchema }, async (request, reply) => {
    try {
      const vendorId = await getVendorId(request, reply);
      return await service.getStallQR(request.params.id, vendorId);
    } catch (err: any) {
      if (err.message === 'Unauthorized') return;
      fastify.log.error(err);
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
};

export default stallController;
```

- [ ] **Step 2: Register the controller in index.ts**

In `src/index.ts`, add the import at the top (near line 38, after the vendorEventController import):

```typescript
import stallController from "./stall/stall.controller";
```

And register the route (after the vendorEventController registration near line 193):

```typescript
fastify.register(stallController, { prefix: "/stalls" });
```

- [ ] **Step 3: Commit**

```bash
git add src/stall/stall.controller.ts src/index.ts
git commit -m "feat(stalls): add stall controller with routes and register at /stalls"
```

---

### Task 4: Unit Tests for StallService

**Files:**
- Create: `src/tests/stall/stall.service.test.ts`

- [ ] **Step 1: Write unit tests**

```typescript
// src/tests/stall/stall.service.test.ts

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
      const event = { id: eventId, name: 'Jollof Fest', code: 'JOLL-abc', origin_type: 'organizer', status: 'ACTIVE' };
      const stallRow = {
        id: 's-1', event_id: eventId, vendor_id: vendorId,
        qr_code: 'VENDOR_EVENT:e-1:v-1:sig', qr_image: 'https://storage.test/qr.png',
        menu_template_id: null, is_direct: false,
        created_at: '2026-04-14', updated_at: '2026-04-14',
      };

      mockFromSequence([
        // 1. Check event_vendors junction (vendor accepted into event)
        createSupabaseMock({ data: { event_id: eventId }, error: null }),
        // 2. Fetch event details
        createSupabaseMock({ data: event, error: null }),
        // 3. Check no existing stall
        createSupabaseMock({ data: null, error: { code: 'PGRST116' } }),
        // 4. Insert event_menu_configurations
        createSupabaseMock({ data: null, error: null }),
        // 5. Insert vendor_events (the stall)
        createSupabaseMock({ data: stallRow, error: null }),
      ]);

      const result = await service.createStall(vendorId, { eventId });

      expect(result.id).toBe('s-1');
      expect(result.eventId).toBe(eventId);
      expect(result.vendorId).toBe(vendorId);
      expect(result.qrImage).toBe('https://storage.test/qr.png');
    });

    it('throws ForbiddenError when vendor is not accepted into event', async () => {
      mockFromSequence([
        // event_vendors returns nothing
        createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'not found' } }),
      ]);

      await expect(
        service.createStall('v-1', { eventId: 'e-1' })
      ).rejects.toThrow('Vendor is not accepted into this event');
    });

    it('throws ValidationError when event is not organizer-created', async () => {
      mockFromSequence([
        createSupabaseMock({ data: { event_id: 'e-1' }, error: null }),
        createSupabaseMock({ data: { id: 'e-1', name: 'Test', code: 'TEST', origin_type: 'vendor', status: 'ACTIVE' }, error: null }),
      ]);

      await expect(
        service.createStall('v-1', { eventId: 'e-1' })
      ).rejects.toThrow('Stalls can only be created at organizer events');
    });

    it('throws ConflictError when vendor already has a stall at event', async () => {
      mockFromSequence([
        createSupabaseMock({ data: { event_id: 'e-1' }, error: null }),
        createSupabaseMock({ data: { id: 'e-1', name: 'Fest', code: 'FEST', origin_type: 'organizer', status: 'ACTIVE' }, error: null }),
        createSupabaseMock({ data: { id: 'existing-stall' }, error: null }),
      ]);

      await expect(
        service.createStall('v-1', { eventId: 'e-1' })
      ).rejects.toThrow('Vendor already has a stall at this event');
    });
  });

  describe('listStalls', () => {
    it('returns only organizer-event stalls with booth info', async () => {
      const stallRow = {
        id: 's-1', event_id: 'e-1', vendor_id: 'v-1',
        qr_code: 'VENDOR_EVENT:e-1:v-1:sig', qr_image: 'https://storage.test/qr.png',
        menu_template_id: null, is_direct: false,
        created_at: '2026-04-14', updated_at: '2026-04-14',
        events: { name: 'Jollof Fest', code: 'JOLL-abc', start_date: '2026-05-01', end_date: '2026-05-02', status: 'ACTIVE', origin_type: 'organizer' },
      };

      mockFromSequence([
        // list vendor_events
        createSupabaseMock({ data: [stallRow], error: null }),
        // fetch booth_info
        createSupabaseMock({ data: [{ event_id: 'e-1', vendor_id: 'v-1', booth_info: 'Stall 12' }], error: null }),
      ]);

      const result = await service.listStalls('v-1');

      expect(result).toHaveLength(1);
      expect(result[0].eventName).toBe('Jollof Fest');
      expect(result[0].boothInfo).toBe('Stall 12');
    });

    it('filters out vendor-created lite events', async () => {
      const vendorEventRow = {
        id: 's-2', event_id: 'e-2', vendor_id: 'v-1',
        qr_code: 'VENDOR_EVENT:e-2:v-1:sig', qr_image: 'https://storage.test/qr.png',
        menu_template_id: null, is_direct: false,
        created_at: '2026-04-14', updated_at: '2026-04-14',
        events: { name: 'My Pop-up', code: 'POP-abc', start_date: '2026-05-01', end_date: '2026-05-02', status: 'ACTIVE', origin_type: 'vendor' },
      };

      mockFromSequence([
        createSupabaseMock({ data: [vendorEventRow], error: null }),
      ]);

      const result = await service.listStalls('v-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('deactivateStall', () => {
    it('deletes the vendor_events record and menu config', async () => {
      mockFromSequence([
        // find stall
        createSupabaseMock({ data: { id: 's-1', event_id: 'e-1' }, error: null }),
        // delete vendor_events
        createSupabaseMock({ data: null, error: null }),
        // delete menu config
        createSupabaseMock({ data: null, error: null }),
      ]);

      await service.deactivateStall('s-1', 'v-1');
      expect(cacheMock.del).toHaveBeenCalledWith('stalls:vendor:v-1');
    });

    it('throws NotFoundError for non-existent stall', async () => {
      mockFromSequence([
        createSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'not found' } }),
      ]);

      await expect(
        service.deactivateStall('s-999', 'v-1')
      ).rejects.toThrow('Stall not found');
    });
  });

  describe('getStallQR', () => {
    it('returns QR code and image', async () => {
      mockFromSequence([
        createSupabaseMock({ data: { qr_code: 'VENDOR_EVENT:e-1:v-1:sig', qr_image: 'https://storage.test/qr.png' }, error: null }),
      ]);

      const result = await service.getStallQR('s-1', 'v-1');
      expect(result.qrCode).toBe('VENDOR_EVENT:e-1:v-1:sig');
      expect(result.qrImage).toBe('https://storage.test/qr.png');
    });
  });

  describe('listAvailableEvents', () => {
    it('returns organizer events vendor is accepted into but has no stall for', async () => {
      mockFromSequence([
        // accepted event_vendors
        createSupabaseMock({ data: [{ event_id: 'e-1' }, { event_id: 'e-2' }], error: null }),
        // organizer events
        createSupabaseMock({ data: [
          { id: 'e-1', name: 'Fest A', code: 'FEST-A', start_date: '2026-05-01', end_date: '2026-05-02', status: 'ACTIVE' },
          { id: 'e-2', name: 'Fest B', code: 'FEST-B', start_date: '2026-06-01', end_date: '2026-06-02', status: 'ACTIVE' },
        ], error: null }),
        // existing stalls (vendor already has stall at e-1)
        createSupabaseMock({ data: [{ event_id: 'e-1' }], error: null }),
      ]);

      const result = await service.listAvailableEvents('v-1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Fest B');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/tests/stall/stall.service.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tests/stall/stall.service.test.ts
git commit -m "test(stalls): add unit tests for StallService"
```

---

### Task 5: Verify Full Build and Integration

- [ ] **Step 1: Run TypeScript compilation check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass, including existing vendor-event tests (unchanged).

- [ ] **Step 3: Start the server locally**

Run: `npx tsx src/index.ts`
Expected: Server starts without errors, `/stalls` routes are registered.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(stalls): address build/test issues"
```
