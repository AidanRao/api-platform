CREATE TABLE ad_campaigns (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  starts_at TEXT, ends_at TEXT, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);
CREATE TABLE ad_creatives (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('image','card')),
  draft TEXT NOT NULL CHECK(json_valid(draft)), published_version INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(id, published_version) REFERENCES ad_creative_versions(creative_id, version) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE ad_creative_versions (
  creative_id TEXT NOT NULL REFERENCES ad_creatives(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK(version > 0), content TEXT NOT NULL CHECK(json_valid(content)),
  published_at TEXT NOT NULL, PRIMARY KEY(creative_id, version)
);
CREATE TABLE ad_slots (
  app_id TEXT NOT NULL, slot_key TEXT NOT NULL, name TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('banner','carousel','card','splash')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  max_items INTEGER NOT NULL CHECK(max_items BETWEEN 1 AND 10 AND (format = 'carousel' OR max_items = 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(app_id, slot_key)
);
CREATE TABLE ad_placements (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id) ON DELETE RESTRICT,
  app_id TEXT NOT NULL, slot_key TEXT NOT NULL,
  creative_id TEXT NOT NULL REFERENCES ad_creatives(id) ON DELETE RESTRICT,
  target_url TEXT, priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), starts_at TEXT, ends_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(app_id, slot_key) REFERENCES ad_slots(app_id, slot_key) ON DELETE RESTRICT,
  CHECK(starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);
CREATE INDEX ad_placements_delivery ON ad_placements(app_id, slot_key, enabled, priority DESC, created_at, id);
CREATE INDEX ad_placements_campaign ON ad_placements(campaign_id, created_at, id);
CREATE INDEX ad_placements_creative ON ad_placements(creative_id, created_at, id);
