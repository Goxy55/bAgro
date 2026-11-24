-- Naplata po proizvodnji: avans (uplata pre prodaje), kupac i veza sa proizvodnjom.
ALTER TABLE payments ADD COLUMN production_id uuid;
ALTER TABLE payments ADD COLUMN buyer text;
ALTER TABLE payments ADD COLUMN advance boolean NOT NULL DEFAULT false;
ALTER TABLE payments ADD CONSTRAINT payments_production_fk FOREIGN KEY (production_id, farm_id) REFERENCES production_periods(id, farm_id);
ALTER TABLE payments ADD CONSTRAINT payments_advance_check CHECK (NOT advance OR (event_id IS NULL AND production_id IS NOT NULL AND direction = 'in'));
UPDATE payments p SET production_id = e.production_id FROM business_events e WHERE p.event_id = e.id AND e.farm_id = p.farm_id AND e.production_id IS NOT NULL;
CREATE INDEX payments_farm_event ON payments(farm_id, event_id);
CREATE INDEX payments_farm_production ON payments(farm_id, production_id);
