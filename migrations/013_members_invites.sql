-- Uloge: owner (vlasnik), member (unosi podatke), viewer (samo pregled).
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK(role IN ('owner','member','viewer'));
-- Pozivnice: čuva se samo hash tokena; važe ograničeno vreme.
CREATE TABLE farm_invites (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL REFERENCES farms(id),
  email text NOT NULL,
  role text NOT NULL CHECK(role IN ('member','viewer')),
  token_hash text NOT NULL UNIQUE,
  invited_by text NOT NULL REFERENCES ba_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz
);
CREATE UNIQUE INDEX farm_invites_pending ON farm_invites(farm_id, lower(email)) WHERE accepted_at IS NULL;
