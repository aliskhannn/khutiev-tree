CREATE TABLE IF NOT EXISTS family_name_changes (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  before_name TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at BIGINT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS family_name_change_request
  ON family_name_changes (person_id, base_revision, name) WHERE status != 'rejected';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS family_name_change_revision
  ON family_name_changes (person_id, base_revision) WHERE status = 'approved';
