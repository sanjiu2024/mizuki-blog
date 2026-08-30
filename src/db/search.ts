export const searchPosts = async (db: any, q: string, limit = 20) => {
  if (!q?.trim()) return [];
  // Accept both D1Database and DrizzleD1Database
  const client: D1Database = db.prepare ? db : (db.$client ?? db.client ?? db);
  // FTS5 raw SQL - drizzle cannot express bm25/snippet
  const stmt = client.prepare(
    `SELECT p.*, bm25(posts_fts) as rank, snippet(posts_fts, '<mark>', '</mark>', '...', -1, 64) as snippet
     FROM posts_fts JOIN posts p ON p.rowid = posts_fts.rowid
     WHERE posts_fts MATCH ? ORDER BY rank LIMIT ?`,
  );
  const res = await stmt.bind(q, limit).all();
  return res.results ?? res;
};
