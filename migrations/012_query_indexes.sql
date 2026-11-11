CREATE INDEX IF NOT EXISTS productions_farm_year ON production_periods(farm_id, year);
CREATE INDEX IF NOT EXISTS feed_farm_production ON feed_consumption(farm_id, production_id);
CREATE INDEX IF NOT EXISTS transfers_farm ON internal_transfers(farm_id, date);
CREATE INDEX IF NOT EXISTS snapshots_farm ON report_snapshots(farm_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS observations_series ON observations(series_id, period);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships(user_id);
