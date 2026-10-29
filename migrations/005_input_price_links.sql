CREATE TABLE input_price_links (
 cost_key text NOT NULL,
 unit text NOT NULL,
 product text NOT NULL,
 manufacturer text NOT NULL,
 packaging text NOT NULL,
 units_per_price numeric NOT NULL CHECK(units_per_price > 0),
 observation_id uuid NOT NULL REFERENCES stips_input_prices(id),
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cost_key,unit)
);
