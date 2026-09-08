import type { APIRoute } from "astro";
import { db } from "../../db/client";
import { auth } from "../../auth";
import { comments } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { extractUserId, toggleCommentLike } from "../../lib/commentLike";

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

interface TreeNode extends CommentRow {
  children: TreeNode[];
}

interface SessionUser {
  name?: string | null;
  image?: string | null;
  email?: string | null;
}

function buildTree(rows: CommentRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  // init nodes
  for (const r of rows) {
    byId.set(r.id, { ...r, children: [], likeCount: Number(r.likeCount ?? 0) });
  }
  for (const r of rows) {
    const node = byId.get(r.id);
    if (!node) continue;
    if (r.parent_id && byId.has(r.parent_id)) {
      const parent = byId.get(r.parent_id);
      if (parent) parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // ensure chronological within each level
  const sortRec = (arr: TreeNode[]): void => {
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
                COUNT(r.id) as likeCount,
                u.name as author_name, u.image as author_image
         FROM comments c
         LEFT JOIN comment_reactions r ON r.comment_id = c.id
         LEFT JOIN users u ON u.id = c.author_id
         WHERE c.post_id = ? AND c.status='approved'
         GROUP BY c.id
         ORDER BY c.created_at ASC`,
      args: [postId],
    });
    const rows = (rs.rows ?? []) as unknown as Array<
      CommentRow & { author_name?: unknown; author_image?: unknown }
    >;
    // Normalize likeCount (sqlite returns integer)
    const normalized: CommentRow[] = rows.map((r) => ({
      id: r.id,
      post_id: r.post_id,
      author_id: r.author_id,
      parent_id: r.parent_id,
      content: r.content,
      status: r.status,
      created_at: r.created_at,
      likeCount: Number(r.likeCount ?? 0),
    }));
    const withAuthors = rows.map((r, i) => ({
      ...normalized[i],
      author: {
        id: r.author_id ?? null,
        name: typeof r.author_name === "string" ? r.author_name : null,
        image: typeof r.author_image === "string" ? r.author_image : null,
      },
    }));
    const tree = buildTree(normalized);
    return new Response(JSON.stringify({ comments: withAuthors, tree }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    // fallback drizzle
    const rows = await db
      .select()
      .from(comments)
      .where(eq(comments.postId, postId))
      .orderBy(desc(comments.createdAt));
    const mapped = await Promise.all(
      rows.map(async (r) => {
        let author: { id: string | null; name: string | null; image: string | null } = {
          id: r.authorId ?? null,
          name: null,
          image: null,
        };
        if (r.authorId) {
          try {
            const u = await db.$client.execute({
              sql: "SELECT id, name, image FROM users WHERE id=?",
              args: [r.authorId],
            });
            const row = u.rows?.[0] as Record<string, unknown> | undefined;
            if (row && typeof row.id === "string") {
              author = {
                id: row.id,
                name: typeof row.name === "string" ? row.name : author.name,
                image: typeof row.image === "string" ? row.image : author.image,
              };
            }
          } catch {}
        }
        return {
          id: r.id,
          post_id: r.postId,
          author_id: r.authorId,
          parent_id: r.parentId,
          content: r.content,
          status: r.status,
          created_at: r.createdAt,
          likeCount: 0,
          author,
        };
      }),
    );
    const tree = buildTree(
      mapped.map((m) => ({
        id: m.id,
        post_id: m.post_id,
        author_id: m.author_id,
        parent_id: m.parent_id,
        content: m.content,
        status: m.status,
        created_at: m.created_at,
        likeCount: m.likeCount,
      })),
    );
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

  const rawBody: unknown = await ctx.request.json().catch(() => ({}));
  const body: Record<string, unknown> =
    typeof rawBody === "object" && rawBody !== null
      ? (rawBody as Record<string, unknown>)
      : {};
  const isLikeRequest =
    maybeLike || body.action === "like" || typeof body.commentId === "string";

  // If it's a like request via this endpoint (POST /api/comments/like style), handle here
  if (
    isLikeRequest &&
    typeof body.commentId === "string" &&
    typeof body.postId !== "string"
  ) {
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
  let sessionUser: SessionUser | null = null;
  try {
    const session = await auth.api.getSession({ headers: ctx.request.headers });
    userId = extractUserId(session);
    sessionUser =
      typeof session === "object" && session !== null
        ? ((session as { user?: unknown }).user as SessionUser | null) ?? null
        : null;
  } catch {}
  if (!userId)
    return new Response(
      JSON.stringify({ error: "未登录，请先登录" }),
      { status: 401 },
    );

  const postId = body.postId;
  const content = body.content;
  const parentId = typeof body.parentId === "string" ? body.parentId : null;
  if (typeof postId !== "string" || typeof content !== "string" || !content.trim())
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
  const now = Date.now();
  await db.insert(comments).values({
    id,
    postId,
    authorId: userId,
    parentId: parentId ?? null,
    content: content.trim(),
    status: "approved",
    createdAt: now,
  });
  let author = {
    id: userId,
    name: sessionUser?.name ?? null,
    image: sessionUser?.image ?? null,
  };
  try {
    const u = await db.$client.execute({
      sql: "SELECT id, name, image FROM users WHERE id=?",
      args: [userId],
    });
    const row = u.rows?.[0] as Record<string, unknown> | undefined;
    if (row && typeof row.id === "string") {
      author = {
        id: row.id,
        name: typeof row.name === "string" ? row.name : author.name,
        image: typeof row.image === "string" ? row.image : author.image,
      };
    }
  } catch {}
  return new Response(
    JSON.stringify({
      ok: true,
      id,
      comment: {
        id,
        post_id: postId,
        author_id: userId,
        parent_id: parentId ?? null,
        content: content.trim(),
        created_at: now,
        likeCount: 0,
        author,
      },
      author,
    }),
    {
      status: 201,
      headers: { "Content-Type": "application/json" },
    },
  );
};

async function handleLike(ctx: Parameters<APIRoute>[0], commentId: string) {
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
    userId = extractUserId(session);
  } catch {
    userId = null;
  }
  if (!userId)
    return new Response(
      JSON.stringify({ error: "未登录，请先登录" }),
      { status: 401 },
    );
  return toggleCommentLike(commentId, userId);
}
