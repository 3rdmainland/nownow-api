-- =============================================================================
-- decrement_inventory: Atomic stock decrement for order items.
-- Called AFTER validate_order_items succeeds and BEFORE create_order_validated.
--
-- Takes validated items array and decrements stock for tracked items.
-- Returns errors if any item is out of stock.
-- Also increments current_order_count for per-item limits.
-- =============================================================================

CREATE OR REPLACE FUNCTION decrement_inventory(
    p_vendor_id   uuid,
    p_event_id    uuid,
    p_items       jsonb   -- Array of { "menuItemId": "uuid", "quantity": N }
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_item          jsonb;
    v_menu_item_id  uuid;
    v_quantity      integer;
    v_rows          integer;
    v_errors        text[] := '{}';
    v_item_name     text;
    v_stock_qty     integer;
    v_low_threshold integer;
    v_low_stock     jsonb := '[]'::jsonb;
    v_sold_out      jsonb := '[]'::jsonb;
    v_is_tracked    boolean;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_menu_item_id := (v_item->>'menuItemId')::uuid;
        v_quantity := (v_item->>'quantity')::integer;

        -- Get item info
        SELECT name, stock_quantity, low_stock_threshold, track_inventory
          INTO v_item_name, v_stock_qty, v_low_threshold, v_is_tracked
          FROM default_menu_items
         WHERE id = v_menu_item_id;

        -- Atomic stock decrement (only for tracked items)
        IF v_is_tracked THEN
            UPDATE default_menu_items
               SET stock_quantity = stock_quantity - v_quantity,
                   updated_at = now()
             WHERE id = v_menu_item_id
               AND track_inventory = true
               AND stock_quantity >= v_quantity;

            GET DIAGNOSTICS v_rows = ROW_COUNT;

            IF v_rows = 0 THEN
                v_errors := array_append(v_errors, format('%s is sold out', COALESCE(v_item_name, 'Item')));
                CONTINUE;
            END IF;

            -- Check post-decrement stock level
            SELECT stock_quantity INTO v_stock_qty
              FROM default_menu_items WHERE id = v_menu_item_id;

            IF v_stock_qty <= 0 THEN
                -- Auto-86: mark as out of stock
                UPDATE default_menu_items
                   SET availability_status = 'OUT_OF_STOCK', updated_at = now()
                 WHERE id = v_menu_item_id;
                v_sold_out := v_sold_out || jsonb_build_object('id', v_menu_item_id, 'name', v_item_name);
            ELSIF v_low_threshold IS NOT NULL AND v_stock_qty <= v_low_threshold THEN
                -- Low stock alert
                UPDATE default_menu_items
                   SET availability_status = 'LIMITED', updated_at = now()
                 WHERE id = v_menu_item_id AND availability_status = 'AVAILABLE';
                v_low_stock := v_low_stock || jsonb_build_object('id', v_menu_item_id, 'name', v_item_name, 'remaining', v_stock_qty);
            END IF;
        END IF;

        -- Per-item max orders (event-scoped)
        UPDATE event_menu_items
           SET current_order_count = current_order_count + v_quantity,
               updated_at = now()
         WHERE default_menu_item_id = v_menu_item_id
           AND event_id = p_event_id
           AND vendor_id = p_vendor_id
           AND (max_total_orders IS NULL OR current_order_count + v_quantity <= max_total_orders);

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows = 0 THEN
            PERFORM 1 FROM event_menu_items
             WHERE default_menu_item_id = v_menu_item_id
               AND event_id = p_event_id
               AND vendor_id = p_vendor_id
               AND max_total_orders IS NOT NULL;
            IF FOUND THEN
                v_errors := array_append(v_errors, format('%s has reached its order limit', COALESCE(v_item_name, 'Item')));
            END IF;
        END IF;
    END LOOP;

    IF array_length(v_errors, 1) > 0 THEN
        RETURN jsonb_build_object('status', 'out_of_stock', 'errors', to_jsonb(v_errors));
    END IF;

    RETURN jsonb_build_object(
        'status', 'ok',
        'low_stock', v_low_stock,
        'sold_out', v_sold_out
    );
END;
$$;

-- =============================================================================
-- restore_inventory: Reverse stock decrement on order cancellation.
-- =============================================================================

CREATE OR REPLACE FUNCTION restore_inventory(
    p_order_id uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_order   record;
    v_item    jsonb;
    v_menu_id uuid;
    v_qty     integer;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN RETURN; END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items)
    LOOP
        v_menu_id := (v_item->>'id')::uuid;
        v_qty := (v_item->>'quantity')::integer;

        UPDATE default_menu_items
           SET stock_quantity = stock_quantity + v_qty,
               availability_status = CASE
                   WHEN stock_quantity + v_qty > 0 AND availability_status = 'OUT_OF_STOCK' THEN 'AVAILABLE'
                   ELSE availability_status
               END,
               updated_at = now()
         WHERE id = v_menu_id AND track_inventory = true;

        UPDATE event_menu_items
           SET current_order_count = GREATEST(0, current_order_count - v_qty),
               updated_at = now()
         WHERE default_menu_item_id = v_menu_id
           AND event_id = v_order.event_id
           AND vendor_id = v_order.vendor_id;
    END LOOP;
END;
$$;
