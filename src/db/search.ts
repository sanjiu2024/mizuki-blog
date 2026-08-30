/**
 * Escape a user query for FTS5 MATCH.
 * Strategy: double inner quotes, strip unbalanced special operators,
 * and wrap tokens that contain FTS5 syntax in double-quotes.
 * Returns a safe string suitable for `WHERE posts_fts MATCH ?`.
 */
export function escapeFts5Query(raw: string): string {
  const q = raw.trim();
  if (!q) return "";
  // Normalize whitespace
  const normalized = q.replace(/\s+/g, " ").trim();
  // Split into tokens preserving quoted phrases naively: split on space
  const tokens = normalized.split(" ");
  const escapedTokens = tokens
    .map((t) => {
      // Strip leading/trailing FTS5 operators that cause syntax errors when bare
      // Remove lone * or operators and surrounding punctuation that breaks FTS5
      let s = t.trim();
      if (!s) return "";
      // Escape double quotes by doubling them (FTS5 rule)
      s = s.replace(/"/g, '""');
      // Remove dangerous suffix/prefix chars that are operators when standalone: * : ^ ( )
      // Keep alphanumeric, CJK, -, _, ., but strip leading/trailing *:
      s = s.replace(/^\*+/, "").replace(/\*+$/, "");
      if (!s) return "";
      // If token contains FTS5 special chars (: ^ ( ) { } - +) or is a bare operator (AND OR NOT NEAR), quote it
      const isOperator = /^(AND|OR|NOT|NEAR)$/i.test(s);
      const hasSpecial = /[:^*(){}+\-]/.test(s) || isOperator;
      // Also if token contains non-ascii punctuation, quoting is safer
      if (hasSpecial) {
        return `"${s}"`;
      }
      // For plain tokens, escape single quotes (not needed for FTS5 but safe) and keep as-is
      // If token has wildcard intent, re-add prefix wildcard: allow trailing * for prefix search is optional — stripped above to avoid errors
      return s;
    })
    .filter(Boolean);
  if (escapedTokens.length === 0) return "";
  // Join tokens implicitly with AND via space (FTS5 default)
  return escapedTokens.join(" ");
}

// Fallback LIKE escaper for % and _
function escapeLike(q: string): string {
  return q.replace(/[%_\\]/g, "\\$&");
}

export const searchPosts = async (db: any, q: string, limit = 20) => {
  if (!q?.trim()) return [];
  const client: D1Database = db.prepare ? db : (db.$client ?? db.client ?? db);
  const escaped = escapeFts5Query(q);
  if (escaped) {
    try {
      const stmt = client.prepare(
        `SELECT p.*, bm25(posts_fts) as rank, snippet(posts_fts, '<mark>', '</mark>', '...', -1, 64) as snippet
         FROM posts_fts JOIN posts p ON p.rowid = posts_fts.rowid
         WHERE posts_fts MATCH ? ORDER BY rank LIMIT ?`,
      );
      const res = await stmt.bind(escaped, limit).all();
      const rows = (res.results ?? res) as any[];
      if (rows && rows.length > 0) return rows;
      // If FTS returns 0 but query non-empty, fall through to LIKE to broaden
    } catch {
      // FTS syntax error -> fallback to LIKE
    }
  }
  // LIKE fallback (escape wildcards)
  try {
    const like = `%${escapeLike(q.trim())}%`;
    const stmt2 = client.prepare(
      `SELECT p.*, 0 as rank, NULL as snippet FROM posts p
       WHERE p.status='published' AND (p.title LIKE ? ESCAPE '\\' OR p.excerpt LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\')
       LIMIT ?`,
    );
    const res2 = await stmt2.bind(like, like, like, limit).all();
    return (res2.results ?? res2) as any[];
  } catch {
    return [];
  }
};
