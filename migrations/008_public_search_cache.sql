CREATE TABLE IF NOT EXISTS public_price_searches (source_id text NOT NULL, query text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(), urls jsonb NOT NULL, PRIMARY KEY(source_id,query));
