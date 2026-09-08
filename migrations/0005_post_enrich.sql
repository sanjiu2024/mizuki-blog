-- 0005: enrich posts with cover + category (CMS upgrade)
ALTER TABLE posts ADD COLUMN cover TEXT;
ALTER TABLE posts ADD COLUMN category TEXT DEFAULT '未分类';
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
-- backfill existing rows
UPDATE posts SET category='未分类' WHERE category IS NULL;
