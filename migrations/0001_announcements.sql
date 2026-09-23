CREATE TABLE announcements (
  app_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'unpublished')),
  published_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, id),
  CHECK (status = 'draft' OR published_at IS NOT NULL)
);
CREATE INDEX announcements_public_order ON announcements(app_id, status, is_pinned DESC, published_at DESC, id DESC);
CREATE INDEX announcements_admin_order ON announcements(app_id, is_pinned DESC, published_at DESC, id DESC);
