CREATE TABLE IF NOT EXISTS properties (
  id text PRIMARY KEY,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  management_company text NOT NULL DEFAULT '',
  owner_name text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  extra_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  property_id text NOT NULL,
  room_number text NOT NULL,
  normalized_room_number text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  extra_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT rooms_property_fk FOREIGN KEY (property_id) REFERENCES properties(id) DEFERRABLE
);

CREATE TABLE IF NOT EXISTS staff (
  id text PRIMARY KEY,
  name text NOT NULL,
  login_user_id text NOT NULL DEFAULT '',
  can_survey boolean NOT NULL DEFAULT false,
  can_work boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  extra_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS cases (
  id text PRIMARY KEY,
  property_id text NOT NULL,
  room_id text NOT NULL,
  property_name text NOT NULL DEFAULT '',
  room_name text NOT NULL DEFAULT '',
  resident_name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  owner_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '問い合わせ',
  lifecycle_status text NOT NULL DEFAULT 'active',
  is_archived boolean NOT NULL DEFAULT false,
  survey_staff_id text NOT NULL DEFAULT '',
  work_staff_id text NOT NULL DEFAULT '',
  survey_at text NOT NULL DEFAULT '',
  work_at text NOT NULL DEFAULT '',
  material_ordered_at text NOT NULL DEFAULT '',
  material_delivery_at text NOT NULL DEFAULT '',
  material_received_at text NOT NULL DEFAULT '',
  estimate_amount numeric NOT NULL DEFAULT 0,
  resident_response_id text NOT NULL DEFAULT '',
  resident_access_token text NOT NULL DEFAULT '',
  resident_access_enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  extra_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cases_property_fk FOREIGN KEY (property_id) REFERENCES properties(id) DEFERRABLE,
  CONSTRAINT cases_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id) DEFERRABLE
);

CREATE UNIQUE INDEX IF NOT EXISTS cases_resident_access_token_uq
  ON cases (resident_access_token) WHERE resident_access_token <> '';

CREATE TABLE IF NOT EXISTS responses (
  id text PRIMARY KEY,
  case_id text NOT NULL,
  property_id text NOT NULL DEFAULT '',
  room_id text NOT NULL DEFAULT '',
  property_name text NOT NULL DEFAULT '',
  room_name text NOT NULL DEFAULT '',
  resident_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  first_date text NOT NULL DEFAULT '',
  first_time text NOT NULL DEFAULT '',
  second_date text NOT NULL DEFAULT '',
  second_time text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  applied boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  extra_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT responses_case_fk FOREIGN KEY (case_id) REFERENCES cases(id) DEFERRABLE
);

CREATE TABLE IF NOT EXISTS workflow_history (
  case_id text NOT NULL,
  position integer NOT NULL,
  step text NOT NULL,
  completed_at text NOT NULL DEFAULT '',
  completed_by text NOT NULL DEFAULT '',
  extra_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (case_id, position),
  CONSTRAINT workflow_history_case_fk FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE DEFERRABLE
);

CREATE TABLE IF NOT EXISTS schedule_history (
  case_id text NOT NULL,
  position integer NOT NULL,
  history_id text NOT NULL DEFAULT '',
  schedule_type text NOT NULL,
  action text NOT NULL,
  old_at text NOT NULL DEFAULT '',
  new_at text NOT NULL DEFAULT '',
  old_duration_minutes integer NOT NULL DEFAULT 0,
  new_duration_minutes integer NOT NULL DEFAULT 0,
  reason_category text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  changed_at text NOT NULL DEFAULT '',
  changed_by text NOT NULL DEFAULT '',
  extra_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (case_id, position),
  CONSTRAINT schedule_history_case_fk FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE DEFERRABLE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_name text NOT NULL DEFAULT '',
  user_id text NOT NULL DEFAULT '',
  case_id text NOT NULL DEFAULT '',
  property_name text NOT NULL DEFAULT '',
  room_name text NOT NULL DEFAULT '',
  detail text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  extra_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS photo_metadata (
  id text PRIMARY KEY,
  case_id text NOT NULL,
  photo_group text NOT NULL,
  name text NOT NULL DEFAULT '',
  mime_type text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL DEFAULT 0,
  storage_provider text NOT NULL DEFAULT 'mock',
  storage_key text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  extra_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT photo_metadata_case_fk FOREIGN KEY (case_id) REFERENCES cases(id) DEFERRABLE
);

CREATE INDEX IF NOT EXISTS rooms_property_id_idx ON rooms (property_id);
CREATE INDEX IF NOT EXISTS cases_property_id_idx ON cases (property_id);
CREATE INDEX IF NOT EXISTS cases_room_id_idx ON cases (room_id);
CREATE INDEX IF NOT EXISTS cases_lifecycle_status_idx ON cases (lifecycle_status);
CREATE INDEX IF NOT EXISTS cases_is_archived_idx ON cases (is_archived);
CREATE INDEX IF NOT EXISTS cases_survey_at_idx ON cases (survey_at) WHERE survey_at <> '';
CREATE INDEX IF NOT EXISTS cases_work_at_idx ON cases (work_at) WHERE work_at <> '';
CREATE INDEX IF NOT EXISTS responses_case_id_idx ON responses (case_id);
CREATE INDEX IF NOT EXISTS workflow_history_case_id_idx ON workflow_history (case_id);
CREATE INDEX IF NOT EXISTS schedule_history_case_id_idx ON schedule_history (case_id);
CREATE INDEX IF NOT EXISTS audit_logs_case_id_idx ON audit_logs (case_id) WHERE case_id <> '';
CREATE INDEX IF NOT EXISTS photo_metadata_case_id_idx ON photo_metadata (case_id);
