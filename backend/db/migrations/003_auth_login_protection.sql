CREATE TABLE IF NOT EXISTS auth_login_attempts (
  subject_hash text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  window_started_at timestamptz NOT NULL,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_login_attempts_locked_until_idx
  ON auth_login_attempts (locked_until) WHERE locked_until IS NOT NULL;
