import type { APIRoute } from "astro";
import { db } from "../../db/client";
import { auth } from "../../auth";
import { comments } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

export const prerender = false;

// ── simple in-memory rate limiter: 5 req / 60s per IP ──
const rateMap = new Map<string, number[]>();
function isRateLimited(ip: string, limit = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = rateMap.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < windowMs);
  recent.push(now);
  rateMap.set(ip, recent);
  // periodic cleanup
  if (rateMap.size > 500) {
    for (const [k, v] of rateMap) {
      const kept = v.filter((t) => now - t < windowMs);
      if (kept.length === 0) rateMap.delete(k);
      else rateMap.set(k, kept);
    }
  }
  return recent.length > limit;
}
function getClientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

type CommentRow = {
  id: string;
  post_id: string;
  author_id: string | null;
  parent_id: string | null;
  content: string;
  status: string;
  created_at: number;
  likeCount: number;
};

function buildTree(rows: CommentRow[]) {
  const byId = new Map<string, any>();
  const roots: any[] = [];
  // init nodes
  for (const r of rows) {
    byId.set(r.id, { ...r, children: [], likeCount: Number(r.likeCount ?? 0) });
  }
  for (const r of rows) {
    const node = byId.get(r.id);
    if (r.parent_id && byId.has(r.parent_id)) {
      byId.get(r.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  // ensure chronological within each level
  const sortRec = (arr: any[]) => {
    arr.sort((a, b) => a.created_at - b.created_at);
    arr.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const postId =
    url.searchParams.get("postId") ?? url.searchParams.get("post_id");
  if (!postId)
    return new Response(JSON.stringify({ error: "缺少 postId 参数" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

  // Use raw SQL to JOIN like counts for efficiency
  try {
    const rs = await db.$client.execute({
      sql: `SELECT c.id, c.post_id, c.author_id, c.parent_id, c.content, c.status, c.created_at,
                COUNT(r.id) as likeCount
         FROM comments c
         LEFT JOIN comment_reactions r ON r.comment_id = c.id
         WHERE c.post_id = ? AND c.status='approved'
         GROUP BY c.id
         ORDER BY c.created_at ASC`,
      args: [postId],
    });
    const rows = (rs.rows ?? []) as unknown as CommentRow[];
    // Normalize likeCount (sqlite returns integer)
    const normalized = rows.map((r: any) => ({
      ...r,
      likeCount: Number(r.likeCount ?? 0),
    }));
    const tree = buildTree(normalized);
    return new Response(JSON.stringify({ comments: normalized, tree }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    // fallback drizzle
    const rows = await db
      .select()
      .from(comments)
      .where(eq(comments.postId, postId))
      .orderBy(desc(comments.createdAt));
    const mapped = rows.map((r: any) => ({
      id: r.id,
      post_id: r.postId,
      author_id: r.authorId,
      parent_id: r.parentId,
      content: r.content,
      status: r.status,
      created_at: r.createdAt,
      likeCount: 0,
    }));
    const tree = buildTree(mapped as any);
    return new Response(JSON.stringify({ comments: mapped, tree }), {
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async (ctx) => {
  // Like action via same endpoint: { commentId, action: 'like' }
  const url = new URL(ctx.request.url);
  const maybeLike =
    url.pathname.endsWith("/like") || url.searchParams.get("action") === "like";

  const body: any = await ctx.request.json().catch(() => ({}));
  const isLikeRequest = maybeLike || body?.action === "like" || body?.commentId;

  // If it's a like request via this endpoint (POST /api/comments/like style), handle here
  if (isLikeRequest && body?.commentId && !body?.postId) {
    return handleLike(ctx, body.commentId);
  }

  // Normal comment creation — rate limit
  const ip = getClientIp(ctx.request as Request);
  if (isRateLimited(ip)) {
    return new Response(
      JSON.stringify({ error: "请求过于频繁，请稍后再试" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  // auth check via better-auth session
  let userId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: ctx.request.headers });
    userId =
      (session as any)?.user?.id ?? (session as any)?.session?.userId ?? null;
  } catch {}
  if (!userId)
    return new Response(
      JSON.stringify({ error: "未登录，请先登录" }),
      { status: 401 },
    );

  const { postId, content, parentId } = body;
  if (!postId || !content?.trim())
    return new Response(
      JSON.stringify({ error: "请填写文章 ID 与评论内容" }),
      { status: 400 },
    );
  if (content.trim().length > 2000)
    return new Response(
      JSON.stringify({ error: "评论过长（最多 2000 字）" }),
      { status: 400 },
    );

  const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await db.insert(comments).values({
    id,
    postId,
    authorId: userId,
    parentId: parentId ?? null,
    content: content.trim(),
    status: "approved",
    createdAt: Date.now(),
  });
  return new Response(JSON.stringify({ ok: true, id }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};

async function handleLike(ctx: any, commentId: string) {
  if (!commentId)
    return new Response(JSON.stringify({ error: "缺少 commentId 参数" }), {
      status: 400,
    });
  const ip = getClientIp(ctx.request as Request);
  if (isRateLimited(`like:${ip}`, 10, 60_000)) {
    return new Response(JSON.stringify({ error: "点赞过于频繁，请稍后再试" }), {
      status: 429,
    });
  }
  let userId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: ctx.request.headers });
    userId =
      (session as any)?.user?.id ?? (session as any)?.session?.userId ?? null;
  } catch {}
  if (!userId)
    return new Response(
      JSON.stringify({ error: "未登录，请先登录" }),
      { status: 401 },
    );
  const id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  try {
    await db.$client.execute({
      sql: "INSERT INTO comment_reactions (id, comment_id, user_id, type) VALUES (?, ?, ?, 'like')",
      args: [id, commentId, userId],
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // Unique constraint -> already liked, toggle off (unlike)
    if (
      msg.includes("UNIQUE") ||
      msg.includes("unique") ||
      msg.includes("idx_reaction_unique")
    ) {
      await db.$client.execute({
        sql: "DELETE FROM comment_reactions WHERE comment_id=? AND user_id=?",
        args: [commentId, userId],
      });
      const cnt = await db.$client.execute({
        sql: "SELECT COUNT(*) as c FROM comment_reactions WHERE comment_id=?",
        args: [commentId],
      });
      return new Response(
        JSON.stringify({
          ok: true,
          liked: false,
          likeCount: Number((cnt.rows?.[0] as any)?.c ?? 0),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: "点赞失败" }), {
      status: 500,
    });
  }
  const cnt = await db.$client.execute({
    sql: "SELECT COUNT(*) as c FROM comment_reactions WHERE comment_id=?",
    args: [commentId],
  });
  return new Response(
    JSON.stringify({
      ok: true,
      liked: true,
      likeCount: Number((cnt.rows?.[0] as any)?.c ?? 1),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
