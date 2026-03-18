ALTER TABLE orders ADD COLUMN customer_id UUID REFERENCES customers(id);

CREATE INDEX idx_orders_customer_id ON orders(customer_id);
