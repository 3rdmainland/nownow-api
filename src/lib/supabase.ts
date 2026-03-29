import { createClient } from "@supabase/supabase-js";
import { supabaseBreaker, CircuitOpenError } from "./circuit-breaker";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

/**
 * Execute a Supabase query through the circuit breaker.
 * When the circuit is OPEN, throws CircuitOpenError so callers can fall back to stale cache.
 *
 * Usage:
 *   const data = await safeQuery(() => supabase.from('orders').select('*').eq('id', id).single());
 */
export async function safeQuery<T>(queryFn: () => Promise<{ data: T; error: any }>): Promise<{ data: T; error: any }> {
    return supabaseBreaker.exec(() => queryFn().then(result => {
        // Supabase returns errors in the response body, not as thrown exceptions.
        // Only count network/timeout failures as breaker failures.
        if (result.error && result.error.message?.includes('FetchError')) {
            throw result.error;
        }
        return result;
    }));
}

export { CircuitOpenError };
