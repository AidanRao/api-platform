CREATE TABLE segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  snapshot_key TEXT NOT NULL,
  student_name_count INTEGER NOT NULL,
  student_id_count INTEGER NOT NULL,
  sso_id_count INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX segments_order ON segments(created_at DESC, id DESC);

CREATE TABLE app_versions (
  app_id TEXT NOT NULL,
  version TEXT NOT NULL,
  major INTEGER NOT NULL,
  minor INTEGER NOT NULL,
  patch INTEGER NOT NULL,
  release_type TEXT NOT NULL DEFAULT 'gray',
  release_notes TEXT NOT NULL DEFAULT '',
  download_url TEXT,
  download_size_bytes INTEGER,
  segment_ids TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, version)
);
CREATE INDEX app_versions_order ON app_versions(app_id, major DESC, minor DESC, patch DESC);

CREATE TABLE app_version_settings (
  app_id TEXT PRIMARY KEY,
  latest_version TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (app_id, latest_version) REFERENCES app_versions(app_id, version) ON DELETE RESTRICT
);
