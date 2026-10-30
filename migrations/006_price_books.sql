CREATE TABLE price_books (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  name text NOT NULL,
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archive')),
  author text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(valid_from<=valid_to)
);
ALTER TABLE norm_versions ADD COLUMN price_book_id uuid REFERENCES price_books(id);
CREATE UNIQUE INDEX price_book_template ON norm_versions(price_book_id,template_id) WHERE price_book_id IS NOT NULL;
CREATE TABLE rzs_price_documents (
  id uuid PRIMARY KEY,
  sha256 text NOT NULL UNIQUE,
  source_url text NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  content bytea NOT NULL,
  author text NOT NULL
);
CREATE TABLE rzs_reference_prices (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES rzs_price_documents(id),
  product text NOT NULL,
  year int NOT NULL,
  price_rsd numeric,
  source_status text NOT NULL,
  raw jsonb NOT NULL,
  UNIQUE(document_id,product,year)
);
CREATE TABLE rzs_input_links (
  cost_key text NOT NULL,
  unit text NOT NULL,
  source_unit text NOT NULL,
  product text NOT NULL,
  observation_id uuid NOT NULL REFERENCES rzs_reference_prices(id),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(cost_key,unit)
);
