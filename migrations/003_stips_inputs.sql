CREATE TABLE stips_input_documents (
 id uuid PRIMARY KEY, sha256 text NOT NULL UNIQUE, source_url text NOT NULL, file_url text NOT NULL,
 title text NOT NULL, filename text NOT NULL, content bytea NOT NULL, category text NOT NULL CHECK(category IN ('pesticidi','djubriva','seme')),
 period_start date NOT NULL, period_end date NOT NULL, published_at date,
 received_at timestamptz NOT NULL DEFAULT now(), received_by text NOT NULL, parser_version text NOT NULL,
 warnings jsonb NOT NULL, counts jsonb NOT NULL, CHECK(period_end>=period_start)
);
CREATE TABLE stips_input_prices (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES stips_input_documents(id),
 sheet text NOT NULL, cell text NOT NULL, product text NOT NULL, manufacturer text NOT NULL,
 packaging text NOT NULL, place text NOT NULL, price_rsd numeric, raw_value jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('available','missing','review')), UNIQUE(document_id,sheet,cell)
);
CREATE INDEX stips_input_doc ON stips_input_prices(document_id);
CREATE INDEX stips_input_product ON stips_input_prices(lower(product));
CREATE TABLE stips_input_runs (
 id uuid PRIMARY KEY, source_url text NOT NULL, actor text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz, status text NOT NULL, document_id uuid REFERENCES stips_input_documents(id), error text
);
CREATE UNIQUE INDEX stips_input_running ON stips_input_runs(source_url) WHERE status='running';
