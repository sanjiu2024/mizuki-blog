import type { APIRoute } from "astro";
import { db } from "../../../../db/client";
import { auth } from "../../../../auth";

export const prerender = false;

interface SessionLike {
  user?: { id?: string | null } | null;
  session?: { userId?: string | null } | null;
}

function extractUserId(session: unknown): string | null {
  if (typeof session !== "object" || session === null) return null;
  const s = session as SessionLike;
  return s.user?.id ?? s.session?.userId ?? null;
}

async function resolvePostId(rawId: string): Promise<string | null> {
  const byId = await db.$client.execute({
    sql: "SELECT id FROM posts WHERE id=?",
    args: [rawId],
  });
  const idVal = byId.rows?.[0] as Record<string, unknown> | undefined;
  if (typeof idVal?.id === "string") return idVal.id;
  const bySlug = await db.$client.execute({
    sql: "SELECT id FROM posts WHERE slug=?",
    args: [rawId],
  });
  const slugVal = bySlug.rows?.[0] as Record<string, unknown> | undefined;
  if (typeof slugVal?.id === "string") return slugVal.id;
  return null;
}

async function getLikeCount(postId: string): Promise<number> {
  const cnt = await db.$client.execute({
    sql: "SELECT COUNT(*) as c FROM post_likes WHERE post_id=?",
    args: [postId],
  });
  const row = cnt.rows?.[0] as Record<string, unknown> | undefined;
  return Number(row?.c ?? 0);
}

export const GET: APIRoute = async (ctx) => {
  const rawId = ctx.params.id;
  if (!rawId)
    return new Response(JSON.stringify({ error: "缺少文章 id 参数" }), {
      status: 400,
    });
  let postId: string | null = null;
  try {
    postId = await resolvePostId(rawId);
  } catch {
    return new Response(JSON.stringify({ error: "查询失败" }), { status: 500 });
  }
  if (!postId)
    return new Response(JSON.stringify({ error: "文章不存在" }), {
      status: 404,
    });
  let userId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: ctx.request.headers });
    userId = extractUserId(session);
  } catch {
    userId = null;
  }
  const count = await getLikeCount(postId);
  let liked = false;
  if (userId) {
    const existing = await db.$client.execute({
      sql: "SELECT id FROM post_likes WHERE post_id=? AND user_id=?",
      args: [postId, userId],
    });
    liked = (existing.rows?.length ?? 0) > 0;
  }
  return new Response(
    JSON.stringify({ liked, count, likeCount: count }),
    { headers: { "Content-Type": "application/json" } },
  );
};

export const POST: APIRoute = async (ctx) => {
  const rawId = ctx.params.id;
  if (!rawId)
    return new Response(JSON.stringify({ error: "缺少文章 id 参数" }), {
      status: 400,
    });
  let userId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: ctx.request.headers });
    userId = extractUserId(session);
  } catch {
    userId = null;
  }
  if (!userId)
    return new Response(JSON.stringify({ error: "未登录，请先登录" }), {
      status: 401,
    });
  let postId: string | null = null;
  try {
    postId = await resolvePostId(rawId);
  } catch {
    return new Response(JSON.stringify({ error: "查询失败" }), { status: 500 });
  }
  if (!postId)
    return new Response(JSON.stringify({ error: "文章不存在" }), {
      status: 404,
    });
  const lid = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await db.$client.execute({
      sql: "INSERT INTO post_likes (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)",
      args: [lid, postId, userId, Date.now()],
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      await db.$client.execute({
        sql: "DELETE FROM post_likes WHERE post_id=? AND user_id=?",
        args: [postId, userId],
      });
      const count = await getLikeCount(postId);
      return new Response(
        JSON.stringify({ liked: false, count, likeCount: count }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: "点赞失败" }), { status: 500 });
  }
  const count = await getLikeCount(postId);
  return new Response(
    JSON.stringify({ liked: true, count, likeCount: count }),
    { headers: { "Content-Type": "application/json" } },
  );
};
