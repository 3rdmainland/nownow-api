# Vendor Menu Cache Invalidation Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a vendor updates their menu, customers see the changes immediately instead of waiting for stale caches to expire.

**Architecture:** Three-layer fix — add a `delByPattern` Redis helper using `scan`, expand `invalidateEventMenuCaches` to also clear vendor-list caches for affected events, and update the frontend WebSocket handler to invalidate vendor-list queries on menu change events.

**Tech Stack:** Upstash Redis, Fastify, TanStack Query v5, React WebSocket

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/redis.ts` | Add `delByPattern` to cache helper + add `scan` to noop client |
| Modify | `src/vendor/menu/vendor-menu.service.ts` | Expand `invalidateEventMenuCaches` to clear vendor-list keys |
| Modify | `packages/features/websocket/WebSocketContext.tsx` | Invalidate vendor-list queries on menu WS events |

---

### Task 1: Add `delByPattern` to Redis cache helper

**Files:**
- Modify: `src/lib/redis.ts:10-27` (noop client) and `src/lib/redis.ts:52-147` (cache object)

- [ ] **Step 1: Add `scan` to the noop Redis client**

In `src/lib/redis.ts`, the `noopRedis` object (line 17) needs a `scan` stub so local dev doesn't break. Add it:

```typescript
const noopRedis = {
    get: async () => null,
    set: async () => 'OK',
    setex: async () => 'OK',
    del: async () => 0,
    exists: async () => 0,
    ping: async () => 'PONG',
    incr: async () => 1,
    expire: async () => 1,
    scan: async () => [0, []], // <-- add this line
    pipeline: () => noopPipeline,
} as unknown as Redis
```

- [ ] **Step 2: Add `delByPattern` method to the `cache` object**

After the existing `mset` method (line 146), add:

```typescript
    // Delete all keys matching a glob pattern (e.g. "vendors:event:abc123:*")
    async delByPattern(pattern: string): Promise<void> {
        let cursor = 0;
        do {
            const [nextCursor, keys] = await redis.scan(cursor, { match: pattern, count: 100 });
            cursor = nextCursor;
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        } while (cursor !== 0);
    },
```

- [ ] **Step 3: Verify the API builds**

Run: `cd /Applications/Amebo/AI/aiticorp/nownow-api && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/redis.ts
git commit -m "feat(redis): add delByPattern helper using scan for glob-based cache invalidation"
```

---

### Task 2: Expand `invalidateEventMenuCaches` to clear vendor-list keys

**Files:**
- Modify: `src/vendor/menu/vendor-menu.service.ts:1458-1467`

- [ ] **Step 1: Update `invalidateEventMenuCaches` to also clear vendor-list caches**

Replace the existing `invalidateEventMenuCaches` method (lines 1458-1467) with:

```typescript
    private async invalidateEventMenuCaches(vendorId: string, eventId: string): Promise<void> {
        try {
            await cache.del(
                menuCacheKeys.eventMenu(vendorId, eventId),
                menuCacheKeys.eventConfig(vendorId, eventId),
                `vendors:event:${eventId}:menuCategories`
            );
            // Clear all paginated vendor-list keys for this event
            // (keys like vendors:event:{eventId}:page:1:size:20, etc.)
            await cache.delByPattern(`vendors:event:${eventId}:*`);
        } catch (error) {
            console.error('Error invalidating event menu caches:', error);
        }
    }
```

This ensures that when any menu item changes for an event, the paginated vendor-list cache (which includes preview menu items) is also cleared — the same pattern used by template application.

- [ ] **Step 2: Verify the API builds**

Run: `cd /Applications/Amebo/AI/aiticorp/nownow-api && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/vendor/menu/vendor-menu.service.ts
git commit -m "fix(menu): invalidate vendor-list caches when event menu changes"
```

---

### Task 3: Invalidate vendor-list queries on frontend WebSocket events

**Files:**
- Modify: `packages/features/websocket/WebSocketContext.tsx:88-116`

- [ ] **Step 1: Add vendor-list query invalidation to all three menu WS event handlers**

In `WebSocketContext.tsx`, update the three menu-related cases to also invalidate the vendor list and menu categories queries. Replace lines 88-116 with:

```typescript
            case 'PRICE_UPDATE': {
              const payload = message.payload as PriceUpdatePayload;
              setLastPriceUpdate(payload);

              // Invalidate menu + vendor list caches
              queryClient.invalidateQueries({
                queryKey: queryKeys.vendors.menuByEvent(payload.vendorId, payload.eventId),
              });
              queryClient.invalidateQueries({
                queryKey: queryKeys.vendors.byEvent(payload.eventId),
              });
              queryClient.invalidateQueries({
                queryKey: queryKeys.vendors.eventMenuCategories(payload.eventId),
              });
              break;
            }

            case 'ITEM_AVAILABILITY_UPDATE': {
              const payload = message.payload as ItemAvailabilityPayload;

              // Invalidate menu + vendor list caches
              queryClient.invalidateQueries({
                queryKey: queryKeys.vendors.menuByEvent(payload.vendorId, payload.eventId),
              });
              queryClient.invalidateQueries({
                queryKey: queryKeys.vendors.byEvent(payload.eventId),
              });
              queryClient.invalidateQueries({
                queryKey: queryKeys.vendors.eventMenuCategories(payload.eventId),
              });
              break;
            }

            case 'MENU_ITEM_UPDATE': {
              const payload = message.payload as { vendorId: string; eventId: string };
              // Invalidate menu + vendor list caches
              queryClient.invalidateQueries({
                queryKey: queryKeys.vendors.menuByEvent(payload.vendorId, payload.eventId),
              });
              queryClient.invalidateQueries({
                queryKey: queryKeys.vendors.byEvent(payload.eventId),
              });
              queryClient.invalidateQueries({
                queryKey: queryKeys.vendors.eventMenuCategories(payload.eventId),
              });
              break;
            }
```

The `queryKeys.vendors.byEvent(eventId)` key prefix-matches all paginated variants of the vendor list query, and `queryKeys.vendors.eventMenuCategories(eventId)` covers the aggregated category list. TanStack Query's `invalidateQueries` uses prefix matching by default, so `byEvent(eventId)` will match `byEvent(eventId, { page: 1, ... })` etc.

- [ ] **Step 2: Verify the frontend builds**

Run: `cd /Applications/Amebo/AI/aiticorp/nownow && npx tsc --noEmit -p packages/features/tsconfig.json` (or whichever build command the monorepo uses)
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/features/websocket/WebSocketContext.tsx
git commit -m "fix(ws): invalidate vendor-list and menu-category queries on menu update events"
```

---

## Verification

After all three tasks, the full invalidation flow is:

1. Vendor updates menu item via API
2. Backend `invalidateEventMenuCaches` clears: event menu cache, event config cache, menu categories cache, **all paginated vendor-list keys** (via `delByPattern`)
3. Backend broadcasts WebSocket event (PRICE_UPDATE / ITEM_AVAILABILITY_UPDATE / MENU_ITEM_UPDATE)
4. Frontend WebSocket handler invalidates: menu query, **vendor list query**, **menu categories query**
5. TanStack Query refetches fresh data from the (now cache-cleared) API
6. Customer sees updated menu immediately
