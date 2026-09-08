-- 0008: add views counter to posts
ALTER TABLE posts ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
