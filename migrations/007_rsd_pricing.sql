ALTER TABLE price_books ADD COLUMN currency text NOT NULL DEFAULT 'EUR' CHECK(currency IN ('RSD','EUR'));
ALTER TABLE internal_transfers ALTER COLUMN value_eur DROP NOT NULL;
ALTER TABLE feed_consumption ALTER COLUMN value_eur DROP NOT NULL;
CREATE TABLE public_price_documents (
  id uuid PRIMARY KEY, source_id text NOT NULL, source_url text NOT NULL,
  sha256 text NOT NULL, retrieved_at timestamptz NOT NULL DEFAULT now(),
  content bytea NOT NULL, metadata jsonb NOT NULL,
  UNIQUE(source_url,sha256)
);
CREATE TABLE public_input_prices (
  id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES public_price_documents(id),
  product text NOT NULL, brand text NOT NULL DEFAULT '',
  unit text NOT NULL, package_quantity numeric NOT NULL CHECK(package_quantity>0),
  price_rsd numeric NOT NULL CHECK(price_rsd>0), composition jsonb,
  price_basis text NOT NULL, available boolean NOT NULL, product_key text NOT NULL,
  UNIQUE(document_id,product_key)
);
CREATE TABLE price_preparations (
  id uuid PRIMARY KEY, book_id uuid NOT NULL REFERENCES price_books(id), author text NOT NULL,
  status text NOT NULL CHECK(status IN ('running','complete','failed')),
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  progress text NOT NULL DEFAULT '', warnings jsonb NOT NULL DEFAULT '[]', result jsonb
);
CREATE UNIQUE INDEX one_price_preparation ON price_preparations(book_id) WHERE status='running';
