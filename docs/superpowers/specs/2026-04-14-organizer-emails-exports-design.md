# Organizer Emails & Exports Design

## Goal

Add transactional emails for organizers at key moments (event created, vendor responses, order milestones, event reminders, event recaps) and wire up export buttons on the organizer settlement pages.

## Architecture

**Inline emails** fire immediately when an action occurs (event created, vendor accepted, order milestone). They use the existing `sendEmail()` helper from `src/lib/email.ts` (Resend) and are fire-and-forget — they don't block the API response.

**Scheduled emails** (24h reminder, event ended recap) run via a new `/internal/organizer-emails/run` endpoint called hourly by QStash. This follows the existing pattern used by `/internal/nudge`, `/internal/cleanup`, and `/internal/reconciliation`. Deduplication uses nullable timestamp columns on the `events` table (`reminder_sent_at`, `recap_sent_at`).

**Exports** reuse the existing `ExportButton` component and `emailCSVExport()` helper. One new backend endpoint is needed for the settlements overview export; the event vendor breakdown endpoint already exists.

## Tech Stack

- Resend (email via `src/lib/email.ts`)
- QStash (Upstash, scheduled cron via `src/lib/qstash.ts`)
- Supabase (DB queries, migration for new columns)
- ExportButton component (`@nownow/ui`)

---

## Feature 1: Event Created Confirmation Email

**Trigger:** Inline, after `eventService.createEvent()` succeeds in `event.controller.ts` POST handler.

**Condition:** Only for `origin_type = 'organizer'` events (not vendor-created).

**Recipient:** Organizer's email, looked up from `organizer_users` table via `organizer_id` on the event.

**Email content:**
- Subject: `Your event "${eventName}" has been created`
- Body: Event name, dates (formatted), event code, link to event page (`${ORGANIZER_APP_URL}/events/${eventId}`)

**Implementation:** Add fire-and-forget `sendEmail()` call after successful event creation in `event.controller.ts`. Look up organizer email from `organizer_users` table using the `organizerId` from the JWT.

---

## Feature 2: Vendor Accepted/Declined Invite Email

**Trigger:** Inline, in `vendor-settlement.controller.ts` where `acceptAgreement` and `declineAgreement` are called. These already have `notifyOrganizer()` calls — add `sendEmail()` alongside.

**Recipient:** Organizer's email, from `organizer_users` using agreement's `organizer_id`.

**Email content (accepted):**
- Subject: `${vendorName} accepted your invite to "${eventName}"`
- Body: Vendor name, event name, commission rate, link to event page

**Email content (declined):**
- Subject: `${vendorName} declined your invite to "${eventName}"`
- Body: Vendor name, event name, link to event page

**Implementation:** After the existing `notifyOrganizer()` call, add a fire-and-forget email. Reuse the vendor/event data already fetched for the notification.

---

## Feature 3: Order Milestone Alerts

**Trigger:** Inline, after a new order is saved in `orderService.createOrder()`.

**Milestones:** 100, 500, 1000 orders per event.

**Logic:**
1. After order insert, query `SELECT count(*) FROM orders WHERE event_id = $1` (fast — indexed).
2. If count matches a milestone exactly, look up the event's `organizer_id`.
3. If `organizer_id` is set (organizer event, not vendor-created), look up organizer email and send.

**Email content:**
- Subject: `🎉 Your event "${eventName}" just hit ${milestone} orders!`
- Body: Event name, milestone reached, current total revenue, link to event page

**Implementation:** Add milestone check at the end of `createOrder()` in `order.service.ts`. Fire-and-forget — doesn't affect order response time.

---

## Feature 4: Event Going Live Reminder (24h before)

**Trigger:** Scheduled, via QStash hourly cron calling `POST /internal/organizer-emails/run`.

**Query:**
```sql
SELECT * FROM events
WHERE origin_type = 'organizer'
  AND status = 'ACTIVE'
  AND start_date BETWEEN now() AND now() + interval '25 hours'
  AND reminder_sent_at IS NULL
```

**Deduplication:** Set `reminder_sent_at = now()` after sending. The 25-hour window (instead of 24) accounts for the hourly cron granularity.

**Recipient:** Organizer email from `organizer_users` via `organizer_id`.

**Email content:**
- Subject: `Your event "${eventName}" starts tomorrow`
- Body: Event name, start time (formatted), number of accepted vendors, link to event page

---

## Feature 5: Event Ended Recap

**Trigger:** Scheduled, same QStash cron as Feature 4.

**Query:**
```sql
SELECT * FROM events
WHERE origin_type = 'organizer'
  AND status = 'ACTIVE'
  AND end_date BETWEEN now() - interval '2 hours' AND now()
  AND recap_sent_at IS NULL
```

**Deduplication:** Set `recap_sent_at = now()` after sending.

**Recipient:** Organizer email from `organizer_users` via `organizer_id`.

**Email content:**
- Subject: `Event recap: "${eventName}"`
- Body: Event name, total orders, total revenue, number of vendors, top vendor by revenue, link to settlement page (`${ORGANIZER_APP_URL}/settlements/${eventId}`)

**Data aggregation:** Quick queries on `orders` table filtered by `event_id` with `payment_status IN ('complete', 'pay_at_stall')`.

---

## Feature 6: Scheduled Endpoint

**New files:**
- `src/organizer-emails/organizer-email.endpoint.ts` — Fastify endpoint with QStash signature verification
- `src/organizer-emails/organizer-email.service.ts` — Business logic for checking events and sending emails

**Endpoint:** `POST /internal/organizer-emails/run`
- Verified by QStash `Receiver` (same pattern as other `/internal/` endpoints)
- Calls service to process reminders and recaps
- Returns `{ reminders: number, recaps: number }` (count of emails sent)

**Registration:** Add to `src/index.ts` with prefix `/internal/organizer-emails`.

**QStash cron:** Schedule hourly (`0 * * * *`) calling `POST /internal/organizer-emails/run`.

---

## Feature 7: Organizer Email Helper

**New utility** in `organizer-email.service.ts`:

```typescript
async function getOrganizerEmail(organizerId: string): Promise<string | null>
```

Looks up organizer email from `organizer_users` table. Cached briefly (60s) since it's called multiple times during a cron run. Reused by all features.

---

## Feature 8: Exports — FE Wiring

### 8a: Event Vendor Breakdown Export (existing endpoint)

**Backend:** `POST /export/organizer/event-breakdown` already exists and works. Has `assertOrganizerOwnsEvent` ownership check (added earlier today).

**Frontend change:** Add `ExportButton` to `/settlements/[eventId]/page.tsx`:
```tsx
<ExportButton
  endpoint="/export/organizer/event-breakdown"
  body={{ eventId }}
  label="Export Breakdown"
/>
```

### 8b: Settlements Overview Export (new endpoint)

**Backend:** New `POST /export/organizer/settlements-overview` endpoint in `export.controller.ts`.
- Requires `authenticateOrganizer`
- Queries all organizer events with order aggregations (total orders, revenue, fees per event)
- Emails CSV with columns: event_name, start_date, end_date, total_orders, gross_revenue, service_fees, net_revenue, vendor_count

**Frontend change:** Add `ExportButton` to `/settlements/page.tsx`:
```tsx
<ExportButton
  endpoint="/export/organizer/settlements-overview"
  label="Export Overview"
/>
```

### 8c: API Config

Add to `packages/api/config.ts` exports section:
```typescript
organizerSettlementsOverview: '/export/organizer/settlements-overview',
```

---

## DB Migration

Add two nullable timestamp columns to `events` table:

```sql
ALTER TABLE events ADD COLUMN reminder_sent_at timestamptz;
ALTER TABLE events ADD COLUMN recap_sent_at timestamptz;
```

No index needed — queries filter on `start_date`/`end_date` which should already be indexed.

---

## Files Changed

### New Files
| File | Purpose |
|------|---------|
| `src/organizer-emails/organizer-email.endpoint.ts` | QStash cron endpoint |
| `src/organizer-emails/organizer-email.service.ts` | Reminder, recap, and email helper logic |

### Modified Files (Backend)
| File | Change |
|------|--------|
| `src/event/event.controller.ts` | Add event-created email (Feature 1) |
| `src/settlement/vendor-settlement.controller.ts` | Add vendor accepted/declined email (Feature 2) |
| `src/orders/order.service.ts` | Add milestone check after order creation (Feature 3) |
| `src/export/export.controller.ts` | Add settlements overview export endpoint (Feature 8b) |
| `src/index.ts` | Register organizer-emails endpoint |

### Modified Files (Frontend)
| File | Change |
|------|--------|
| `nownow/apps/organizer/src/app/settlements/page.tsx` | Add ExportButton for overview |
| `nownow/apps/organizer/src/app/settlements/[eventId]/page.tsx` | Add ExportButton for breakdown |
| `nownow/packages/api/config.ts` | Add export endpoint config |

### DB Migration
| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDD_organizer_email_columns.sql` | Add `reminder_sent_at`, `recap_sent_at` to events |
