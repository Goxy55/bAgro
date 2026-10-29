-- Missing publication dates remain unknown; dataset updates are a different fact.
ALTER TABLE observations ALTER COLUMN published_at DROP NOT NULL;
ALTER TABLE observations ADD COLUMN source_updated_at date;
ALTER TABLE observations ADD COLUMN source_status jsonb;
