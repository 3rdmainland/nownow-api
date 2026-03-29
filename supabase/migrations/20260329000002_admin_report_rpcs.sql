-- RPC: get_revenue_by_day
-- Server-side aggregation for admin revenue report (replaces pulling all order rows)

CREATE OR REPLACE FUNCTION get_revenue_by_day(
  p_start_date text DEFAULT NULL,
  p_end_date text DEFAULT NULL
)
RETURNS TABLE(day text, revenue numeric, order_count bigint)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    to_char(o.created_at, 'YYYY-MM-DD') AS day,
    COALESCE(sum(o.total), 0) AS revenue,
    count(*) AS order_count
  FROM orders o
  WHERE o.status = 'completed'
    AND (p_start_date IS NULL OR o.created_at >= p_start_date::timestamptz)
    AND (p_end_date IS NULL OR o.created_at <= (p_end_date || 'T23:59:59.999Z')::timestamptz)
  GROUP BY to_char(o.created_at, 'YYYY-MM-DD')
  ORDER BY day;
END;
$$;


-- RPC: get_peak_hours
-- Server-side aggregation for admin peak hours analysis

CREATE OR REPLACE FUNCTION get_peak_hours(
  p_start_date text DEFAULT NULL,
  p_end_date text DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
)
RETURNS TABLE(hour int, order_count bigint, revenue numeric)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    extract(hour FROM o.created_at)::int AS hour,
    count(*) AS order_count,
    COALESCE(sum(o.total), 0) AS revenue
  FROM orders o
  WHERE o.payment_status = 'complete'
    AND (p_start_date IS NULL OR o.created_at >= p_start_date::timestamptz)
    AND (p_end_date IS NULL OR o.created_at <= (p_end_date || 'T23:59:59.999Z')::timestamptz)
    AND (p_event_id IS NULL OR o.event_id = p_event_id)
  GROUP BY extract(hour FROM o.created_at)::int
  ORDER BY hour;
END;
$$;
