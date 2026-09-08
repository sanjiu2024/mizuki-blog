CREATE TABLE IF NOT EXISTS post_likes (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE(post_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_like_unique ON post_likes(post_id, user_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);
