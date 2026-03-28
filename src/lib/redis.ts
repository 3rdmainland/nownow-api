import { Redis } from '@upstash/redis'

const hasRedisCredentials = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)

if (!hasRedisCredentials && process.env.NODE_ENV === 'production') {
    throw new Error('Missing Upstash Redis credentials in environment variables')
}

// No-op Redis client for when Redis is unavailable (local dev, load testing)
const noopPipeline = {
    get: () => noopPipeline,
    set: () => noopPipeline,
    setex: () => noopPipeline,
    del: () => noopPipeline,
    exec: async () => [],
}
const noopRedis = {
    get: async () => null,
    set: async () => 'OK',
    setex: async () => 'OK',
    del: async () => 0,
    exists: async () => 0,
    ping: async () => 'PONG',
    incr: async () => 1,
    expire: async () => 1,
    pipeline: () => noopPipeline,
} as unknown as Redis

// Create Redis client singleton (real or no-op)
export const redis = hasRedisCredentials
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
    : noopRedis

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
    VENDOR_LIST: 3600,      // 60 minutes (1 hour)
    VENDOR_DETAILS: 60,    // 1 minute
    MENU_ITEMS: 300,            // 5 minutes
    ITEM_AVAILABILITY: 10,     // 10 seconds
    USER_SESSION: 3600,        // 1 hour
    USER_CART: 1800,           // 30 minutes
    ACTIVE_ORDERS: 5,          // 5 seconds
} as const

// Type-safe cache helpers
export const cache = {
    // Get with automatic JSON parsing
    async get<T>(key: string): Promise<T | null> {
        const data = await redis.get(key)
        return data as T | null
    },

    // Set with automatic JSON stringification and TTL
    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
        if (ttl) {
            await redis.setex(key, ttl, JSON.stringify(value))
        } else {
            await redis.set(key, JSON.stringify(value))
        }
    },

    // Delete one or more keys
    async del(...keys: string[]): Promise<void> {
        if (keys.length > 0) {
            await redis.del(...keys)
        }
    },

    // Check if key exists
    async exists(key: string): Promise<boolean> {
        const result = await redis.exists(key)
        return result === 1
    },

    // Batch get multiple keys in a single round-trip (uses Upstash pipeline)
    async mget<T>(...keys: string[]): Promise<(T | null)[]> {
        if (keys.length === 0) return []
        if (keys.length === 1) return [await cache.get<T>(keys[0])]

        const pipeline = redis.pipeline()
        for (const key of keys) pipeline.get(key)
        const results = await pipeline.exec<(T | null)[]>()
        return results
    },

    // Batch set multiple key-value pairs in a single round-trip
    async mset<T>(entries: { key: string; value: T; ttl?: number }[]): Promise<void> {
        if (entries.length === 0) return

        const pipeline = redis.pipeline()
        for (const { key, value, ttl } of entries) {
            if (ttl) {
                pipeline.setex(key, ttl, JSON.stringify(value))
            } else {
                pipeline.set(key, JSON.stringify(value))
            }
        }
        await pipeline.exec()
    },
}

export default redis
