import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from './supabase.js';
import { cache } from './redis.js';
import { NotFoundError } from './errors.js';

const CACHE_KEY = 'platform:feature_flags';
const CACHE_TTL = 30; // seconds

export type FeatureFlag =
  | 'vendor_pos'
  | 'vendor_billing'
  | 'menu_templates'
  | 'discounts'
  | 'retention'
  | 'reorder'
  | 'push_notifications'
  | 'online_payments'
  | 'vendor_events';

export type FeatureFlags = Record<string, boolean>;

// In-memory cache to avoid Upstash HTTP round-trip on every request
let inMemoryFlags: FeatureFlags | null = null;
let inMemoryExpiry = 0;
const IN_MEMORY_TTL_MS = 5_000; // 5 seconds

// Singleflight: deduplicate concurrent fetches
let inflight: Promise<FeatureFlags> | null = null;

/**
 * Get all feature flags. Uses in-memory cache → Redis → Supabase fallback.
 * Deduplicates concurrent requests to prevent cache stampede.
 */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  // 1. In-memory cache (avoids Upstash HTTP call entirely)
  if (inMemoryFlags && Date.now() < inMemoryExpiry) {
    return inMemoryFlags;
  }

  // 2. Deduplicate concurrent requests
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      // 3. Redis cache
      const cached = await cache.get<FeatureFlags>(CACHE_KEY);
      if (cached) {
        inMemoryFlags = cached;
        inMemoryExpiry = Date.now() + IN_MEMORY_TTL_MS;
        return cached;
      }

      // 4. Supabase fallback
      const { data, error } = await supabase
        .from('platform_config')
        .select('value')
        .eq('key', 'feature_flags')
        .single();

      if (error || !data) return {};

      const flags = (data.value as FeatureFlags) ?? {};
      await cache.set(CACHE_KEY, flags, CACHE_TTL);
      inMemoryFlags = flags;
      inMemoryExpiry = Date.now() + IN_MEMORY_TTL_MS;
      return flags;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Check if a specific feature flag is enabled.
 */
export async function isFeatureEnabled(flag: string): Promise<boolean> {
  const flags = await getFeatureFlags();
  return flags[flag] === true;
}

/**
 * Invalidate the cached feature flags so changes take effect immediately.
 */
export async function invalidateFeatureFlagsCache(): Promise<void> {
  await cache.del(CACHE_KEY);
  inMemoryFlags = null;
  inMemoryExpiry = 0;
}

/**
 * Fastify preHandler that returns 404 if the given feature flag is disabled.
 * Usage: `{ preHandler: [requireFeature('discounts')] }`
 */
export function requireFeature(flag: string) {
  return async (_request: FastifyRequest, reply: FastifyReply) => {
    const enabled = await isFeatureEnabled(flag);
    if (!enabled) {
      return reply.status(404).send({ error: 'Not found' });
    }
  };
}
