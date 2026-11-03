CREATE TABLE cost_calendar_policies (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL UNIQUE,
 name text NOT NULL,
 status text NOT NULL CHECK(status IN ('active','archive')),
 policy jsonb NOT NULL,
 author text NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_calendar_policy ON cost_calendar_policies((1)) WHERE status='active';
CREATE TABLE wip_snapshots (
 id uuid PRIMARY KEY,
 farm_id uuid NOT NULL REFERENCES farms(id),
 production_id uuid,
 as_of text NOT NULL CHECK(as_of ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 previous_id uuid REFERENCES wip_snapshots(id),
 author text NOT NULL,
 reason text NOT NULL,
 generated_at timestamptz NOT NULL DEFAULT now(),
 payload jsonb NOT NULL,
 FOREIGN KEY(production_id,farm_id) REFERENCES production_periods(id,farm_id)
);
CREATE INDEX farm_wip_snapshots ON wip_snapshots(farm_id,generated_at DESC);
