-- =============================================================================
-- validate_order_items: Server-side price calculation + modifier validation.
--
-- Input: vendor_id, event_id, items as JSONB array of:
--   [{ "menuItemId": "uuid", "quantity": N, "selectedModifiers": { "groupId": ["modId", ...] } }]
--
-- Returns JSONB:
--   { "status": "ok", "items": [...validated items with prices...], "total": N }
-- or:
--   { "status": "validation_error", "errors": ["..."] }
--
-- DB schema (verified):
--   default_menu_items: id, vendor_id, name, base_price, image_url, prep_time,
--     is_active, availability_status, track_inventory, stock_quantity,
--     modifier_group_ids (uuid[])
--   event_menu_items: id, event_id, vendor_id, default_menu_item_id,
--     price_override, availability_override, prep_time_override, is_included,
--     max_total_orders, current_order_count
--   modifier_groups: id, vendor_id, name, selection_type, is_required,
--     min_selections, max_selections, is_active
--     (linked via default_menu_items.modifier_group_ids array, NOT FK)
--   modifiers: id, group_id, name, price_adjustment, is_available, is_default
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_order_items(
    p_vendor_id   uuid,
    p_event_id    uuid,
    p_items       jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_item            jsonb;
    v_item_idx        integer := 0;
    v_menu_item       record;
    v_event_menu_item record;
    v_mod_group       record;
    v_modifier        record;
    v_group_id        text;
    v_mod_ids         jsonb;
    v_mod_id          text;
    v_selected_count  integer;
    v_base_price      numeric(10,2);
    v_modifier_total  numeric(10,2);
    v_item_price      numeric(10,2);
    v_order_total     numeric(10,2) := 0;
    v_errors          text[] := '{}';
    v_validated_items jsonb := '[]'::jsonb;
    v_mod_names       text[];
    v_menu_item_id    uuid;
    v_quantity        integer;
    v_item_name       text;
    v_item_image      text;
    v_prep_time       integer;
    v_group_ids       uuid[];
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RETURN jsonb_build_object('status', 'validation_error', 'errors', to_jsonb(ARRAY['No items provided']));
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_idx := v_item_idx + 1;
        v_menu_item_id := (v_item->>'menuItemId')::uuid;
        v_quantity := COALESCE((v_item->>'quantity')::integer, 1);
        v_modifier_total := 0;
        v_mod_names := '{}';

        -- Validate quantity
        IF v_quantity < 1 OR v_quantity > 99 THEN
            v_errors := array_append(v_errors, format('Item %s: quantity must be between 1 and 99', v_item_idx));
            CONTINUE;
        END IF;

        -- Fetch default menu item with row lock
        SELECT id, name, base_price, image_url, prep_time, is_active,
               availability_status, track_inventory, stock_quantity, vendor_id,
               modifier_group_ids
          INTO v_menu_item
          FROM default_menu_items
         WHERE id = v_menu_item_id
           AND vendor_id = p_vendor_id
           FOR UPDATE;

        IF NOT FOUND THEN
            v_errors := array_append(v_errors, format('Item %s: menu item not found', v_item_idx));
            CONTINUE;
        END IF;

        IF NOT v_menu_item.is_active THEN
            v_errors := array_append(v_errors, format('Item %s: %s is no longer available', v_item_idx, v_menu_item.name));
            CONTINUE;
        END IF;

        IF v_menu_item.availability_status = 'OUT_OF_STOCK' THEN
            v_errors := array_append(v_errors, format('Item %s: %s is sold out', v_item_idx, v_menu_item.name));
            CONTINUE;
        END IF;

        -- Fetch event-specific override
        SELECT id, price_override, availability_override, prep_time_override,
               is_included, max_total_orders, current_order_count
          INTO v_event_menu_item
          FROM event_menu_items
         WHERE default_menu_item_id = v_menu_item_id
           AND event_id = p_event_id
           AND vendor_id = p_vendor_id;

        IF FOUND AND NOT v_event_menu_item.is_included THEN
            v_errors := array_append(v_errors, format('Item %s: %s is not available at this event', v_item_idx, v_menu_item.name));
            CONTINUE;
        END IF;

        IF FOUND AND v_event_menu_item.availability_override = 'OUT_OF_STOCK' THEN
            v_errors := array_append(v_errors, format('Item %s: %s is sold out at this event', v_item_idx, v_menu_item.name));
            CONTINUE;
        END IF;

        -- Resolve price and metadata
        v_base_price := COALESCE(v_event_menu_item.price_override, v_menu_item.base_price);
        v_item_name := v_menu_item.name;
        v_item_image := COALESCE(v_menu_item.image_url, '');
        v_prep_time := COALESCE(v_event_menu_item.prep_time_override, v_menu_item.prep_time, 10);
        v_group_ids := COALESCE(v_menu_item.modifier_group_ids, '{}');

        -- Validate modifiers (if any provided)
        IF v_item->'selectedModifiers' IS NOT NULL
           AND v_item->'selectedModifiers' != 'null'::jsonb
           AND v_item->'selectedModifiers' != '{}'::jsonb THEN

            FOR v_group_id, v_mod_ids IN SELECT * FROM jsonb_each(v_item->'selectedModifiers')
            LOOP
                -- Verify this group belongs to this menu item (via modifier_group_ids array)
                IF NOT (v_group_id::uuid = ANY(v_group_ids)) THEN
                    v_errors := array_append(v_errors, format('Item %s (%s): modifier group %s does not belong to this item', v_item_idx, v_item_name, v_group_id));
                    CONTINUE;
                END IF;

                -- Fetch modifier group
                SELECT id, name, selection_type, is_required, min_selections, max_selections
                  INTO v_mod_group
                  FROM modifier_groups
                 WHERE id = v_group_id::uuid
                   AND is_active = true;

                IF NOT FOUND THEN
                    v_errors := array_append(v_errors, format('Item %s (%s): modifier group %s not found or inactive', v_item_idx, v_item_name, v_group_id));
                    CONTINUE;
                END IF;

                v_selected_count := jsonb_array_length(v_mod_ids);

                -- Selection type constraint
                IF v_mod_group.selection_type = 'SINGLE' AND v_selected_count > 1 THEN
                    v_errors := array_append(v_errors, format('Item %s (%s): %s allows only 1 selection', v_item_idx, v_item_name, v_mod_group.name));
                    CONTINUE;
                END IF;

                -- Max selections constraint
                IF v_mod_group.max_selections IS NOT NULL AND v_selected_count > v_mod_group.max_selections THEN
                    v_errors := array_append(v_errors, format('Item %s (%s): %s allows max %s selections', v_item_idx, v_item_name, v_mod_group.name, v_mod_group.max_selections));
                    CONTINUE;
                END IF;

                -- Min selections constraint
                IF v_mod_group.min_selections IS NOT NULL AND v_selected_count < v_mod_group.min_selections THEN
                    v_errors := array_append(v_errors, format('Item %s (%s): %s requires at least %s selections', v_item_idx, v_item_name, v_mod_group.name, v_mod_group.min_selections));
                    CONTINUE;
                END IF;

                -- Validate each modifier and sum price adjustments
                FOR v_mod_id IN SELECT * FROM jsonb_array_elements_text(v_mod_ids)
                LOOP
                    SELECT id, name, price_adjustment, is_available
                      INTO v_modifier
                      FROM modifiers
                     WHERE id = v_mod_id::uuid
                       AND group_id = v_group_id::uuid;

                    IF NOT FOUND THEN
                        v_errors := array_append(v_errors, format('Item %s (%s): modifier %s not found in %s', v_item_idx, v_item_name, v_mod_id, v_mod_group.name));
                        CONTINUE;
                    END IF;

                    IF NOT v_modifier.is_available THEN
                        v_errors := array_append(v_errors, format('Item %s (%s): %s is unavailable', v_item_idx, v_item_name, v_modifier.name));
                        CONTINUE;
                    END IF;

                    v_modifier_total := v_modifier_total + COALESCE(v_modifier.price_adjustment, 0);
                    v_mod_names := array_append(v_mod_names, v_modifier.name);
                END LOOP;
            END LOOP;

            -- Check required groups that weren't provided
            FOR v_mod_group IN
                SELECT mg.id, mg.name
                  FROM modifier_groups mg
                 WHERE mg.id = ANY(v_group_ids)
                   AND mg.is_required = true
                   AND mg.is_active = true
                   AND mg.id::text NOT IN (SELECT jsonb_object_keys(v_item->'selectedModifiers'))
            LOOP
                v_errors := array_append(v_errors, format('Item %s (%s): %s is required', v_item_idx, v_item_name, v_mod_group.name));
            END LOOP;
        ELSE
            -- No modifiers provided — check if any are required
            FOR v_mod_group IN
                SELECT mg.id, mg.name
                  FROM modifier_groups mg
                 WHERE mg.id = ANY(v_group_ids)
                   AND mg.is_required = true
                   AND mg.is_active = true
            LOOP
                v_errors := array_append(v_errors, format('Item %s (%s): %s is required', v_item_idx, v_item_name, v_mod_group.name));
            END LOOP;
        END IF;

        -- Calculate final price
        v_item_price := GREATEST(0, v_base_price + v_modifier_total);
        v_order_total := v_order_total + (v_item_price * v_quantity);

        -- Build validated item (matches OrderItem interface)
        v_validated_items := v_validated_items || jsonb_build_object(
            'id', v_menu_item_id,
            'name', v_item_name,
            'price', v_item_price,
            'basePrice', v_base_price,
            'imageUrl', v_item_image,
            'prepTime', v_prep_time,
            'quantity', v_quantity,
            'vendorId', p_vendor_id,
            'vendorName', '',
            'selectedModifiers', COALESCE(v_item->'selectedModifiers', '{}'::jsonb),
            'modifierSummary', array_to_string(v_mod_names, ', ')
        );
    END LOOP;

    -- Return errors if any
    IF array_length(v_errors, 1) > 0 THEN
        RETURN jsonb_build_object(
            'status', 'validation_error',
            'errors', to_jsonb(v_errors)
        );
    END IF;

    RETURN jsonb_build_object(
        'status', 'ok',
        'items', v_validated_items,
        'total', v_order_total
    );
END;
$$;
