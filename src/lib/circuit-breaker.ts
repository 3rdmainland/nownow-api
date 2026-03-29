/**
 * Lightweight circuit breaker for Supabase (or any async operation).
 *
 * States:
 *   CLOSED   → normal operation, requests pass through
 *   OPEN     → requests fail immediately (or return stale cache)
 *   HALF_OPEN → one probe request allowed; success → CLOSED, failure → OPEN
 *
 * Config:
 *   failureThreshold: consecutive failures to trip open (default: 5)
 *   resetTimeoutMs:   how long OPEN state lasts before HALF_OPEN probe (default: 30s)
 */

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
    failureThreshold?: number;
    resetTimeoutMs?: number;
}

export class CircuitBreaker {
    private state: CircuitState = 'CLOSED';
    private failureCount = 0;
    private lastFailureTime = 0;
    private readonly failureThreshold: number;
    private readonly resetTimeoutMs: number;

    constructor(config?: CircuitBreakerConfig) {
        this.failureThreshold = config?.failureThreshold ?? 5;
        this.resetTimeoutMs = config?.resetTimeoutMs ?? 30_000;
    }

    /** Current circuit state — useful for health checks / logging */
    getState(): CircuitState {
        this.maybeTransitionToHalfOpen();
        return this.state;
    }

    /** Is the circuit allowing requests? */
    isAllowing(): boolean {
        this.maybeTransitionToHalfOpen();
        return this.state !== 'OPEN';
    }

    /**
     * Execute an async function through the circuit breaker.
     * Throws if the circuit is OPEN (caller should handle with stale cache).
     */
    async exec<T>(fn: () => Promise<T>): Promise<T> {
        this.maybeTransitionToHalfOpen();

        if (this.state === 'OPEN') {
            throw new CircuitOpenError('Circuit breaker is OPEN — Supabase unavailable');
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (err) {
            this.onFailure();
            throw err;
        }
    }

    private onSuccess(): void {
        this.failureCount = 0;
        if (this.state === 'HALF_OPEN') {
            this.state = 'CLOSED';
        }
    }

    private onFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }

    private maybeTransitionToHalfOpen(): void {
        if (this.state === 'OPEN' && Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
            this.state = 'HALF_OPEN';
        }
    }
}

export class CircuitOpenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CircuitOpenError';
    }
}

/** Singleton circuit breaker for Supabase operations */
export const supabaseBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
});
