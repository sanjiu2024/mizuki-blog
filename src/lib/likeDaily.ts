// 每人每天最多点一个赞 —— 每日点赞配额辅助函数。
// 设计：活跃点赞表（post_likes / comment_reactions）+ 每日历史表
// （post_like_daily / comment_like_daily，主键包含 like_day）。
// 取消点赞只删除活跃行、保留历史行，因此同一天取消后再点会被 429 拦截。

export interface ExecClient {
  execute: (stmt: { sql: string; args: unknown[] }) => Promise<{
    rows?: Array<Record<string, unknown>>;
    rowsAffected?: number;
  }>;
}

type CountRow = Record<string, unknown>;

function countOf(rows: Array<CountRow> | undefined): number {
  const row = rows?.[0];
  return Number(row?.c ?? 0);
}

/** 当天日期键（UTC，YYYY-MM-DD），前后端/库行为一致。 */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** 不存在则建表：生产 D1 / 旧库即使没跑迁移也能自愈，保证点赞可保存。 */
export async function ensurePostLikeTables(client: ExecClient): Promise<void> {
  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS post_likes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      UNIQUE(post_id, user_id)
    )`,
    args: [],
  });
  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS post_like_daily (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      like_day TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, user_id, like_day)
    )`,
    args: [],
  });
}

export async function ensureCommentLikeTables(
  client: ExecClient,
): Promise<void> {
  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS comment_reactions (
      id TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'like',
      created_at INTEGER,
      UNIQUE(comment_id, user_id)
    )`,
    args: [],
  });
  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS comment_like_daily (
      comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      like_day TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (comment_id, user_id, like_day)
    )`,
    args: [],
  });
  // 兼容旧库：comment_reactions 可能没有 created_at 列
  try {
    await client.execute({
      sql: "ALTER TABLE comment_reactions ADD COLUMN created_at INTEGER",
      args: [],
    });
  } catch {
    // 列已存在时忽略（duplicate column 错误）
  }
}

/** 今天是否已经点过赞（含已取消的历史）。 */
export async function hasPostLikedToday(
  client: ExecClient,
  postId: string,
  userId: string,
  day: string,
): Promise<boolean> {
  const rs = await client.execute({
    sql: "SELECT 1 as hit FROM post_like_daily WHERE post_id=? AND user_id=? AND like_day=? LIMIT 1",
    args: [postId, userId, day],
  });
  return (rs.rows?.length ?? 0) > 0;
}

export async function hasCommentLikedToday(
  client: ExecClient,
  commentId: string,
  userId: string,
  day: string,
): Promise<boolean> {
  const rs = await client.execute({
    sql: "SELECT 1 as hit FROM comment_like_daily WHERE comment_id=? AND user_id=? AND like_day=? LIMIT 1",
    args: [commentId, userId, day],
  });
  return (rs.rows?.length ?? 0) > 0;
}

/**
 * 记录当日点赞配额。返回 true=占用成功；false=今天已点过（并发下主键冲突）。
 * 调用方应在确认配额后写入活跃表；若活跃表写入失败，应回滚配额行以免误伤次日？
 * 不回滚：配额行代表“今天点过”，与需求一致（失败也算一次尝试会被 429，属保守限流）。
 */
export async function claimPostDailyLike(
  client: ExecClient,
  postId: string,
  userId: string,
  day: string,
  now: number,
): Promise<boolean> {
  try {
    await client.execute({
      sql: "INSERT INTO post_like_daily (post_id, user_id, like_day, created_at) VALUES (?, ?, ?, ?)",
      args: [postId, userId, day, now],
    });
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique") || msg.includes("PRIMARY")) {
      return false;
    }
    throw e;
  }
}

export async function claimCommentDailyLike(
  client: ExecClient,
  commentId: string,
  userId: string,
  day: string,
  now: number,
): Promise<boolean> {
  try {
    await client.execute({
      sql: "INSERT INTO comment_like_daily (comment_id, user_id, like_day, created_at) VALUES (?, ?, ?, ?)",
      args: [commentId, userId, day, now],
    });
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique") || msg.includes("PRIMARY")) {
      return false;
    }
    throw e;
  }
}

export async function countPostLikes(
  client: ExecClient,
  postId: string,
): Promise<number> {
  const rs = await client.execute({
    sql: "SELECT COUNT(*) as c FROM post_likes WHERE post_id=?",
    args: [postId],
  });
  return countOf(rs.rows);
}

export async function countCommentLikes(
  client: ExecClient,
  commentId: string,
): Promise<number> {
  const rs = await client.execute({
    sql: "SELECT COUNT(*) as c FROM comment_reactions WHERE comment_id=?",
    args: [commentId],
  });
  return countOf(rs.rows);
}
