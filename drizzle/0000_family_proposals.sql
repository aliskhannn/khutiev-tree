CREATE TABLE IF NOT EXISTS family_proposals (
  id TEXT PRIMARY KEY,
  parent TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL,
  request_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS family_proposals_active_request
  ON family_proposals (request_key) WHERE status != 'rejected';
