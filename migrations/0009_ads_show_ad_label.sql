ALTER TABLE ad_placements ADD COLUMN show_ad_label INTEGER NOT NULL DEFAULT 1 CHECK (show_ad_label IN (0, 1));
