-- 0009: 每人每天最多点一个赞 —— 每日点赞历史表。
-- 活跃表（post_likes / comment_reactions）保持不变（取消点赞仍删除活跃行）；
-- 历史表主键含 like_day（UTC YYYY-MM-DD），取消后重建同日行会被主键/429 拦截。

CREATE TABLE IF NOT EXISTS post_like_daily (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  like_day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id, like_day)
);
CREATE INDEX IF NOT EXISTS idx_post_like_daily_user_day ON post_like_daily(user_id, like_day);

CREATE TABLE IF NOT EXISTS comment_like_daily (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  like_day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id, like_day)
);
CREATE INDEX IF NOT EXISTS idx_comment_like_daily_user_day ON comment_like_daily(user_id, like_day);
