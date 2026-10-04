CREATE TABLE buaa_classhopper_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  login_name TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL DEFAULT '',
  course_schedule_id TEXT NOT NULL,
  course_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  schedule_version INTEGER NOT NULL DEFAULT 0,
  workflow_instance_id TEXT,
  active_attempt_id TEXT,
  next_attempt_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  result_message TEXT,
  result_code INTEGER,
  result_data_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  events_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE (user_id, login_name, course_schedule_id)
);
CREATE INDEX buaa_reservations_by_user
  ON buaa_classhopper_reservations(user_id, created_at DESC, id DESC);
CREATE INDEX buaa_reservations_by_student_status
  ON buaa_classhopper_reservations(student_id, status, created_at DESC, id DESC);
CREATE INDEX buaa_reservations_by_status
  ON buaa_classhopper_reservations(status, created_at DESC, id DESC);
CREATE INDEX buaa_reservations_active_workflows
  ON buaa_classhopper_reservations(status, next_attempt_at)
  WHERE schedule_version > 0;

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  permissions_json TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX api_tokens_by_app ON api_tokens(app_id, created_at DESC, id DESC);
