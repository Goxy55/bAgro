-- Retencija briše po vremenu, a pregled radnji korisnika traži po korisniku.
CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS audit_user ON audit_log(user_id, at);
