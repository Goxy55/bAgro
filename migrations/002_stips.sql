CREATE TABLE IF NOT EXISTS stips_documents (
 id uuid PRIMARY KEY, sha256 text NOT NULL UNIQUE, filename text NOT NULL, title text NOT NULL,
 mime text NOT NULL CHECK(mime IN ('application/pdf','text/html')), content bytea NOT NULL,
 source_url text NOT NULL, published_at date, period_start date, period_end date,
 terms_confirmed boolean NOT NULL DEFAULT false, terms_note text NOT NULL DEFAULT '',
 received_at timestamptz NOT NULL DEFAULT now(), received_by text NOT NULL,
 extracted_at timestamptz, extractor_version text NOT NULL, extraction_status text NOT NULL,
 text_content text NOT NULL DEFAULT '', tables jsonb NOT NULL DEFAULT '[]', pages int NOT NULL DEFAULT 0,
 extraction_warnings jsonb NOT NULL DEFAULT '[]', CHECK(period_end IS NULL OR period_start IS NULL OR period_end>=period_start)
);
CREATE TABLE IF NOT EXISTS stips_rows (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES stips_documents(id), source_key text NOT NULL,
 origin text NOT NULL CHECK(origin IN ('auto','mapped','manual')), page int NOT NULL, table_index int,
 source_row int, source_column int, raw_cells jsonb NOT NULL, raw_quote text NOT NULL,
 draft jsonb NOT NULL, issues jsonb NOT NULL, edited boolean NOT NULL DEFAULT false,
 published jsonb, revision int NOT NULL DEFAULT 0, withdrawn boolean NOT NULL DEFAULT false,
 updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(document_id,source_key)
);
CREATE INDEX IF NOT EXISTS stips_document_rows ON stips_rows(document_id);
CREATE TABLE IF NOT EXISTS stips_row_history (
 id uuid PRIMARY KEY, row_id uuid NOT NULL REFERENCES stips_rows(id), action text NOT NULL,
 previous_draft jsonb, previous_published jsonb, revision int NOT NULL, reason text NOT NULL,
 actor text NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stips_crawler_settings (
 id int PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT false,
 listing_urls jsonb NOT NULL DEFAULT '["https://www.stips.minpolj.gov.rs/"]',
 interval_hours int NOT NULL DEFAULT 24 CHECK(interval_hours BETWEEN 6 AND 168),
 max_documents int NOT NULL DEFAULT 5 CHECK(max_documents BETWEEN 1 AND 10),
 terms_confirmed boolean NOT NULL DEFAULT false, terms_note text NOT NULL DEFAULT '',
 next_check_at timestamptz, lease_until timestamptz, last_success_at timestamptz, last_error text,
 updated_by text NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO stips_crawler_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS stips_fetch_runs (
 id uuid PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 status text NOT NULL, actor text NOT NULL, discovered int NOT NULL DEFAULT 0,
 imported int NOT NULL DEFAULT 0, duplicates int NOT NULL DEFAULT 0,
 errors jsonb NOT NULL DEFAULT '[]', links jsonb NOT NULL DEFAULT '[]'
);
