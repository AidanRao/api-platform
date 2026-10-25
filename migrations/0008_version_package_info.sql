-- Installation metadata now uses one validated JSON object. The deployed version table is empty.
ALTER TABLE app_versions ADD COLUMN package_info TEXT;
ALTER TABLE app_versions DROP COLUMN download_url;
ALTER TABLE app_versions DROP COLUMN download_size_bytes;
DROP INDEX app_versions_order;
ALTER TABLE app_versions DROP COLUMN major;
ALTER TABLE app_versions DROP COLUMN minor;
ALTER TABLE app_versions DROP COLUMN patch;
ALTER TABLE app_versions ADD COLUMN version_code INTEGER NOT NULL;
CREATE INDEX app_versions_order ON app_versions(app_id, version_code DESC, version DESC);
