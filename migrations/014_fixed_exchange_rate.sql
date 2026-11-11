-- Fiksni (interni) kurs za period: nije zvanična NBS lista i uvek ima manji
-- prioritet od zvaničnog kursa koji važi za isti datum.
ALTER TABLE exchange_rates ADD COLUMN kind text NOT NULL DEFAULT 'official' CHECK(kind IN ('official','fixed'));
ALTER TABLE exchange_rates ADD COLUMN note text;
ALTER TABLE exchange_rates DROP CONSTRAINT IF EXISTS exchange_rates_valid_from_key;
ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_from_kind_key UNIQUE(valid_from, kind);
