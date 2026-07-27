CREATE TABLE IF NOT EXISTS demo_launch_tickets (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  issued_by_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  target_origin TEXT NOT NULL CHECK (length(trim(target_origin)) > 0),
  return_path TEXT NOT NULL CHECK (substr(return_path, 1, 1) = '/'),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issued_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS demo_launch_tickets_expires_at_idx
ON demo_launch_tickets(expires_at);

CREATE INDEX IF NOT EXISTS demo_launch_tickets_target_user_idx
ON demo_launch_tickets(target_user_id);
