-- RPC: get_vendors_by_event
-- Returns vendors for an event with their menu items in a single round-trip.
-- Replaces N+1 queries (event_vendors + vendors + menu items + categories + configs + orders).

CREATE OR REPLACE FUNCTION get_vendors_by_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(vendor_row ORDER BY vendor_row->>'name')
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'id', v.id,
      'name', v.name,
      'description', v.description,
      'phone', v.phone,
      'email', v.email,
      'image_url', v.image_url,
      'logo_url', v.logo_url,
      'category_id', v.category_id,
      'cuisine_type', v.cuisine_type,
      'rating', v.rating,
      'total_reviews', v.total_reviews,
      'location', v.location,
      'hours', v.hours,
      'is_active', v.is_active,
      'is_paused', v.is_paused,
      'minimum_order', v.minimum_order,
      'delivery_fee', v.delivery_fee,
      'service_fee_percent', v.service_fee_percent,
      'estimated_prep_time', v.estimated_prep_time,
      'payment_methods', v.payment_methods,
      'created_at', v.created_at,
      'updated_at', v.updated_at,
      'display_order', ev.display_order,
      'vendor_categories', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'category_id', vc.category_id,
          'categories', jsonb_build_object('id', c.id, 'name', c.name)
        ))
        FROM vendor_categories vc
        LEFT JOIN categories c ON c.id = vc.category_id
        WHERE vc.vendor_id = v.id
      ), '[]'::jsonb),
      'menu_items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', mi.id,
          'vendor_id', mi.vendor_id,
          'category_id', mi.category_id,
          'name', mi.name,
          'description', mi.description,
          'base_price', mi.base_price,
          'image_url', mi.image_url,
          'type', mi.type,
          'prep_time', mi.prep_time,
          'is_alcohol', mi.is_alcohol,
          'created_at', mi.created_at,
          'updated_at', mi.updated_at
        ))
        FROM default_menu_items mi
        WHERE mi.vendor_id = v.id
          AND mi.is_active = true
          AND mi.availability_status = 'AVAILABLE'
      ), '[]'::jsonb),
      'event_config', (
        SELECT jsonb_build_object(
          'is_accepting_orders', emc.is_accepting_orders,
          'status', emc.status,
          'event_open_time', emc.event_open_time,
          'event_close_time', emc.event_close_time,
          'operating_schedule', emc.operating_schedule
        )
        FROM event_menu_configurations emc
        WHERE emc.event_id = p_event_id AND emc.vendor_id = v.id
        LIMIT 1
      ),
      'order_count', (
        SELECT count(*)::int
        FROM orders o
        WHERE o.event_id = p_event_id
          AND o.vendor_id = v.id
          AND o.status != 'CANCELLED'
      )
    ) AS vendor_row
    FROM event_vendors ev
    JOIN vendors v ON v.id = ev.vendor_id
    WHERE ev.event_id = p_event_id
      AND ev.status = 'accepted'
      AND v.is_active = true
  ) sub;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
