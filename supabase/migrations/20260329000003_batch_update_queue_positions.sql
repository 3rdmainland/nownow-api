-- Batch-update queue positions for all PENDING orders of a vendor in one round-trip.
-- Replaces N individual UPDATE statements with a single RPC call.
CREATE OR REPLACE FUNCTION batch_update_queue_positions(p_vendor_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY scheduled_pickup_time ASC) AS pos
    FROM orders
    WHERE vendor_id = p_vendor_id
      AND status = 'PENDING'
  )
  UPDATE orders
  SET queue_position = ranked.pos
  FROM ranked
  WHERE orders.id = ranked.id;
$$;
