-- =============================================================================
-- create_order_validated: Single-transaction RPC for order creation.
--
-- Replaces 8-10 individual REST queries with 1 DB call.
-- Validates event, vendor, menu config, capacity, cooldown, max orders,
-- dedup, idempotency, fetches customer name, calculates queue position,
-- and inserts the order row — all under row-level locks.
--
-- Returns JSONB with either:
--   { "status": "ok", "order": {...}, "vendor": {...}, "queue_position": N,
--     "estimated_ready_time": "...", "customer_name": "..." }
-- or:
--   { "status": "<error_code>", "message": "...", "meta": {...} }
-- =============================================================================

CREATE OR REPLACE FUNCTION create_order_validated(
    p_vendor_id          uuid,
    p_event_id           uuid,
    p_phone              text,
    p_items              jsonb,
    p_total              numeric(10,2),
    p_payment_method     text,         -- 'CASH' or 'ONLINE'
    p_notes              text DEFAULT NULL,
    p_customer_id        uuid DEFAULT NULL,
    p_customer_name      text DEFAULT NULL,
    p_idempotency_key    text DEFAULT NULL,
    p_estimated_prep_time integer DEFAULT NULL,
    p_queue_position     integer DEFAULT NULL,
    p_estimated_ready_time timestamptz DEFAULT NULL,
    p_scheduled_pickup_time timestamptz DEFAULT NULL,
    p_service_fee        numeric(10,2) DEFAULT 0,
    p_age_verified       boolean DEFAULT false,
    p_qr_code            text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_vendor           record;
    v_event            record;
    v_menu_config      record;
    v_order            record;
    v_existing_order   record;
    v_cooldown_hit     boolean := false;
    v_last_order_at    timestamptz;
    v_wait_seconds     integer;
    v_customer_count   integer;
    v_dup_count        integer;
    v_queue_pos        integer;
    v_queue_wait       integer;
    v_est_ready        timestamptz;
    v_order_status     text;
    v_order_type       text;
    v_payment_status   text;
    v_prep_time        integer;
    v_customer_name_resolved text;
BEGIN
    -- =========================================================================
    -- 1. Idempotency check (fast path — return existing order if key matches)
    -- =========================================================================
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_order
          FROM orders
         WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'status', 'idempotent_hit',
                'order', row_to_json(v_existing_order)::jsonb
            );
        END IF;
    END IF;

    -- =========================================================================
    -- 2. Fetch and validate vendor
    -- =========================================================================
    SELECT id, estimated_prep_time, name, minimum_order, service_fee_percent
      INTO v_vendor
      FROM vendors
     WHERE id = p_vendor_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'vendor_not_found', 'message', 'Vendor not found');
    END IF;

    v_prep_time := COALESCE(p_estimated_prep_time, v_vendor.estimated_prep_time, 12);

    -- =========================================================================
    -- 3. Fetch and validate event
    -- =========================================================================
    SELECT id, start_date, end_date, status
      INTO v_event
      FROM events
     WHERE id = p_event_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'event_not_found', 'message', 'Event not found');
    END IF;

    IF now() < v_event.start_date THEN
        RETURN jsonb_build_object('status', 'event_not_started', 'message', 'This event has not started yet.');
    END IF;

    -- Inclusive of the end day (23:59:59)
    IF now() > (v_event.end_date::date + interval '1 day' - interval '1 millisecond') THEN
        RETURN jsonb_build_object('status', 'event_ended', 'message', 'This event has ended. Orders are no longer accepted.');
    END IF;

    -- =========================================================================
    -- 4. Fetch menu config with row lock (FOR UPDATE prevents concurrent races)
    -- =========================================================================
    SELECT *
      INTO v_menu_config
      FROM event_menu_configurations
     WHERE vendor_id = p_vendor_id AND event_id = p_event_id
       FOR UPDATE;

    IF FOUND THEN
        -- 4a. Check accepting orders
        IF NOT v_menu_config.is_accepting_orders THEN
            RETURN jsonb_build_object('status', 'not_accepting', 'message', 'This vendor is not currently accepting orders.');
        END IF;

        -- 4b. Check status
        IF v_menu_config.status = 'PAUSED' THEN
            RETURN jsonb_build_object('status', 'paused', 'message', 'This vendor has temporarily paused orders. Please try again shortly.');
        END IF;
        IF v_menu_config.status = 'CLOSED' THEN
            RETURN jsonb_build_object('status', 'closed', 'message', 'This vendor has closed for this event.');
        END IF;

        -- 4c. Capacity check + atomic increment
        IF v_menu_config.max_concurrent_orders IS NOT NULL
           AND v_menu_config.current_active_orders >= v_menu_config.max_concurrent_orders THEN
            RETURN jsonb_build_object(
                'status', 'at_capacity',
                'message', format('This vendor is at capacity (%s concurrent orders). Please wait a few minutes and try again.', v_menu_config.max_concurrent_orders),
                'meta', jsonb_build_object('max', v_menu_config.max_concurrent_orders, 'current', v_menu_config.current_active_orders)
            );
        END IF;

        -- Increment active orders (inside the same transaction + row lock)
        IF v_menu_config.max_concurrent_orders IS NOT NULL THEN
            UPDATE event_menu_configurations
               SET current_active_orders = current_active_orders + 1,
                   updated_at = now()
             WHERE vendor_id = p_vendor_id AND event_id = p_event_id;
        END IF;

        -- 4d. Cooldown check
        IF v_menu_config.order_cooldown_minutes IS NOT NULL AND v_menu_config.order_cooldown_minutes > 0 THEN
            SELECT created_at INTO v_last_order_at
              FROM orders
             WHERE vendor_id = p_vendor_id
               AND event_id = p_event_id
               AND phone = p_phone
               AND created_at >= (now() - (v_menu_config.order_cooldown_minutes || ' minutes')::interval)
             ORDER BY created_at DESC
             LIMIT 1;

            IF FOUND THEN
                v_wait_seconds := GREATEST(1, EXTRACT(EPOCH FROM (v_last_order_at + (v_menu_config.order_cooldown_minutes || ' minutes')::interval) - now())::integer);
                RETURN jsonb_build_object(
                    'status', 'cooldown',
                    'message', format('This vendor is managing order flow. Please try again in %s.',
                        CASE WHEN v_wait_seconds < 60 THEN v_wait_seconds || 's' ELSE ceil(v_wait_seconds / 60.0)::integer || 'm' END),
                    'meta', jsonb_build_object('wait_seconds', v_wait_seconds)
                );
            END IF;
        END IF;

        -- 4e. Max orders per customer check
        IF v_menu_config.max_orders_per_customer_event IS NOT NULL AND p_phone IS NOT NULL THEN
            SELECT count(*) INTO v_customer_count
              FROM orders
             WHERE vendor_id = p_vendor_id
               AND event_id = p_event_id
               AND phone = p_phone;

            IF v_customer_count >= v_menu_config.max_orders_per_customer_event THEN
                RETURN jsonb_build_object(
                    'status', 'max_orders_reached',
                    'message', format('You have reached the maximum of %s order(s) allowed per customer at this event.', v_menu_config.max_orders_per_customer_event)
                );
            END IF;
        END IF;

        -- 4f. Apply prep time buffer
        IF v_menu_config.prep_time_buffer_minutes IS NOT NULL THEN
            v_prep_time := v_prep_time + v_menu_config.prep_time_buffer_minutes;
        END IF;
    END IF;

    -- =========================================================================
    -- 5. Validate pay-at-stall
    -- =========================================================================
    IF p_payment_method = 'CASH' THEN
        IF NOT FOUND OR NOT COALESCE(v_menu_config.allow_pay_at_stall, false) THEN
            RETURN jsonb_build_object('status', 'cash_not_allowed', 'message', 'Pay at stall is not available for this vendor at this event.');
        END IF;
    END IF;

    -- =========================================================================
    -- 6. Customer name resolution (for online payment)
    -- =========================================================================
    v_customer_name_resolved := p_customer_name;
    IF p_payment_method != 'CASH' AND v_customer_name_resolved IS NULL AND p_customer_id IS NOT NULL THEN
        SELECT name INTO v_customer_name_resolved
          FROM customers
         WHERE id = p_customer_id;
    END IF;

    IF p_payment_method != 'CASH' AND v_customer_name_resolved IS NULL THEN
        RETURN jsonb_build_object('status', 'customer_name_required', 'message', 'Customer name is required for online payment. Please update your profile.');
    END IF;

    -- =========================================================================
    -- 7. Dedup guard (30-second window)
    -- =========================================================================
    IF p_phone IS NOT NULL AND p_vendor_id IS NOT NULL THEN
        SELECT count(*) INTO v_dup_count
          FROM orders
         WHERE phone = p_phone
           AND vendor_id = p_vendor_id
           AND total = p_total
           AND event_id = p_event_id
           AND created_at >= (now() - interval '30 seconds');

        IF v_dup_count > 0 THEN
            RETURN jsonb_build_object('status', 'duplicate', 'message', 'A duplicate order was detected. Please wait a moment before ordering again.');
        END IF;
    END IF;

    -- =========================================================================
    -- 8. Queue position calculation
    -- =========================================================================
    SELECT count(*), COALESCE(sum(COALESCE(estimated_prep_time, 0)), 0)
      INTO v_queue_pos, v_queue_wait
      FROM orders
     WHERE vendor_id = p_vendor_id
       AND status IN ('PENDING', 'PREPARING')
       AND (p_scheduled_pickup_time IS NULL
            OR COALESCE(scheduled_pickup_time, created_at) <= p_scheduled_pickup_time);

    v_queue_pos := v_queue_pos + 1;
    v_est_ready := now() + (v_queue_wait || ' minutes')::interval;

    -- Use caller-provided values if given (scheduler may have computed them)
    IF p_queue_position IS NOT NULL THEN
        v_queue_pos := p_queue_position;
    END IF;
    IF p_estimated_ready_time IS NOT NULL THEN
        v_est_ready := p_estimated_ready_time;
    END IF;

    -- =========================================================================
    -- 9. Determine order status/type based on payment method
    -- =========================================================================
    IF p_payment_method = 'CASH' THEN
        v_order_status := 'PENDING';
        v_order_type := 'ORDER';
        v_payment_status := 'pay_at_stall';
    ELSE
        v_order_status := 'PAYMENT_PENDING';
        v_order_type := 'CART';
        v_payment_status := 'pending';
    END IF;

    -- =========================================================================
    -- 10. INSERT the order
    -- =========================================================================
    INSERT INTO orders (
        vendor_id, event_id, phone, items, total, status, type,
        notes, estimated_prep_time, payment_method, payment_status,
        qr_code, qr_image, scheduled_pickup_time, queue_position,
        estimated_ready_time, age_verified, age_verified_at,
        customer_id, service_fee, idempotency_key
    ) VALUES (
        p_vendor_id, p_event_id, p_phone, p_items, p_total,
        v_order_status::order_status, v_order_type::order_type,
        p_notes, v_prep_time, p_payment_method, v_payment_status,
        COALESCE(p_qr_code, 'PENDING-' || extract(epoch from now())::bigint || '-' || substr(md5(random()::text), 1, 8)),
        '', p_scheduled_pickup_time, v_queue_pos,
        v_est_ready, p_age_verified,
        CASE WHEN p_age_verified THEN now() ELSE NULL END,
        p_customer_id, COALESCE(p_service_fee, 0), p_idempotency_key
    )
    RETURNING * INTO v_order;

    -- =========================================================================
    -- 11. Return success with all data the JS layer needs
    -- =========================================================================
    RETURN jsonb_build_object(
        'status', 'ok',
        'order', row_to_json(v_order)::jsonb,
        'vendor', jsonb_build_object(
            'name', v_vendor.name,
            'estimated_prep_time', v_vendor.estimated_prep_time,
            'minimum_order', v_vendor.minimum_order,
            'service_fee_percent', v_vendor.service_fee_percent
        ),
        'menu_config', CASE WHEN v_menu_config IS NOT NULL THEN jsonb_build_object(
            'is_accepting_orders', v_menu_config.is_accepting_orders,
            'status', v_menu_config.status,
            'max_concurrent_orders', v_menu_config.max_concurrent_orders,
            'operating_schedule', v_menu_config.operating_schedule,
            'event_open_time', v_menu_config.event_open_time,
            'event_close_time', v_menu_config.event_close_time,
            'allow_pay_at_stall', v_menu_config.allow_pay_at_stall,
            'prep_time_buffer_minutes', v_menu_config.prep_time_buffer_minutes
        ) ELSE NULL END,
        'event', jsonb_build_object(
            'start_date', v_event.start_date,
            'end_date', v_event.end_date
        ),
        'queue_position', v_queue_pos,
        'estimated_ready_time', v_est_ready,
        'customer_name', v_customer_name_resolved,
        'capacity_incremented', (v_menu_config.max_concurrent_orders IS NOT NULL)
    );
END;
$$;

-- Composite index for the dedup query inside the RPC
CREATE INDEX IF NOT EXISTS idx_orders_phone_vendor_total_created
    ON orders (phone, vendor_id, total, created_at DESC);

-- Composite index for cooldown query
CREATE INDEX IF NOT EXISTS idx_orders_phone_vendor_event_created
    ON orders (phone, vendor_id, event_id, created_at DESC);
