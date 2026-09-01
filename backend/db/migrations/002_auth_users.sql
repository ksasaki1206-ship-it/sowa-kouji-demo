CREATE TABLE IF NOT EXISTS auth_users (
  id text PRIMARY KEY,
  login_id text NOT NULL CHECK (btrim(login_id) <> ''),
  email text,
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  role text NOT NULL CHECK (role IN ('admin', 'office', 'worker')),
  staff_id text,
  active boolean NOT NULL DEFAULT true,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  password_params jsonb NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_users_email_not_blank CHECK (email IS NULL OR btrim(email) <> ''),
  CONSTRAINT auth_users_worker_staff CHECK (role <> 'worker' OR staff_id IS NOT NULL),
  CONSTRAINT auth_users_staff_fk FOREIGN KEY (staff_id) REFERENCES staff(id) DEFERRABLE
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_login_id_uq ON auth_users (lower(login_id));
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_uq ON auth_users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS auth_users_role_active_idx ON auth_users (role, active);
CREATE INDEX IF NOT EXISTS auth_users_staff_id_idx ON auth_users (staff_id) WHERE staff_id IS NOT NULL;
