-- Atomic increment of current_active_orders with capacity check.
-- Returns the new count, or -1 if at capacity (so the app can throw a validation error).
CREATE OR REPLACE FUNCTION increment_active_orders(
    p_vendor_id uuid,
    p_event_id uuid
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_current integer;
    v_max integer;
BEGIN
    -- Lock the row to prevent concurrent reads
    SELECT current_active_orders, max_concurrent_orders
      INTO v_current, v_max
      FROM event_menu_configurations
     WHERE vendor_id = p_vendor_id AND event_id = p_event_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 0; -- No config row, allow order (no capacity limit)
    END IF;

    -- Check capacity
    IF v_max IS NOT NULL AND v_current >= v_max THEN
        RETURN -1; -- At capacity
    END IF;

    -- Increment
    UPDATE event_menu_configurations
       SET current_active_orders = current_active_orders + 1,
           updated_at = now()
     WHERE vendor_id = p_vendor_id AND event_id = p_event_id;

    RETURN v_current + 1;
END;
$$;

-- Atomic decrement of current_active_orders (floor at 0).
CREATE OR REPLACE FUNCTION decrement_active_orders(
    p_vendor_id uuid,
    p_event_id uuid
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_new integer;
BEGIN
    UPDATE event_menu_configurations
       SET current_active_orders = GREATEST(current_active_orders - 1, 0),
           updated_at = now()
     WHERE vendor_id = p_vendor_id AND event_id = p_event_id
     RETURNING current_active_orders INTO v_new;

    RETURN COALESCE(v_new, 0);
END;
$$;

-- Add idempotency_key column to orders table with a unique constraint.
-- Clients send a UUID; if the same key is re-submitted the insert is rejected.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
    ON orders (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Index for the stale PAYMENT_PENDING cleanup query
CREATE INDEX IF NOT EXISTS idx_orders_payment_pending_created
    ON orders (created_at)
    WHERE status = 'PAYMENT_PENDING';
