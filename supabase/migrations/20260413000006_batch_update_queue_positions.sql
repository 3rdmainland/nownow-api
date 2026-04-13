CREATE OR REPLACE FUNCTION batch_update_queue_positions(
    p_vendor_id uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    WITH ranked AS (
        SELECT
            id,
            ROW_NUMBER() OVER (ORDER BY created_at ASC) AS new_position
        FROM orders
        WHERE vendor_id = p_vendor_id
          AND status IN ('PENDING', 'PREPARING')
    )
    UPDATE orders o
       SET queue_position = r.new_position
      FROM ranked r
     WHERE o.id = r.id
       AND o.queue_position IS DISTINCT FROM r.new_position;
END;
$$;
