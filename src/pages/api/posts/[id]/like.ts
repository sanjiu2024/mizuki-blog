import type { APIRoute } from "astro";
import { db } from "../../../../db/client";
import { auth } from "../../../../auth";
import {
  claimPostDailyLike,
  countPostLikes,
  ensurePostLikeTables,
  hasPostLikedToday,
  todayKey,
  type ExecClient,
} from "../../../../lib/likeDaily";

export const prerender = false;

interface SessionLike {
  user?: { id?: string | null } | null;
  session?: { userId?: string | null } | null;
}

type RowMap = Record<string, unknown>;

function extractUserId(session: unknown): string | null {
  if (typeof session !== "object" || session === null) return null;
  const s = session as SessionLike;
  return s.user?.id ?? s.session?.userId ?? null;
}

function client(): ExecClient {
  return db.$client as unknown as ExecClient;
}

async function resolvePostId(rawId: string): Promise<string | null> {
  const c = client();
  const byId = await c.execute({
    sql: "SELECT id FROM posts WHERE id=?",
    args: [rawId],
  });
  const idVal = byId.rows?.[0] as RowMap | undefined;
  if (typeof idVal?.id === "string") return idVal.id;
  const bySlug = await c.execute({
    sql: "SELECT id FROM posts WHERE slug=?",
    args: [rawId],
  });
  const slugVal = bySlug.rows?.[0] as RowMap | undefined;
  if (typeof slugVal?.id === "string") return slugVal.id;
  return null;
}

async function getLikeCount(postId: string): Promise<number> {
  try {
    return await countPostLikes(client(), postId);
  } catch {
    return 0;
  }
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
    try {
      const existing = await client().execute({
        sql: "SELECT id FROM post_likes WHERE post_id=? AND user_id=?",
        args: [postId, userId],
      });
      liked = (existing.rows?.length ?? 0) > 0;
    } catch {
      liked = false;
    }
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
  const c = client();
  try {
    await ensurePostLikeTables(c);
  } catch {
    return new Response(JSON.stringify({ error: "点赞失败" }), { status: 500 });
  }
  // 已点赞 → 取消（只删活跃行，保留当日配额记录，同日不可再点）
  try {
    const existing = await c.execute({
      sql: "SELECT id FROM post_likes WHERE post_id=? AND user_id=?",
      args: [postId, userId],
    });
    if ((existing.rows?.length ?? 0) > 0) {
      await c.execute({
        sql: "DELETE FROM post_likes WHERE post_id=? AND user_id=?",
        args: [postId, userId],
      });
      const count = await getLikeCount(postId);
      return new Response(
        JSON.stringify({ liked: false, count, likeCount: count }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
  } catch {
    return new Response(JSON.stringify({ error: "点赞失败" }), { status: 500 });
  }
  // 每人每天每篇文章最多点一个赞（含已取消的历史）
  const day = todayKey();
  const now = Date.now();
  try {
    if (await hasPostLikedToday(c, postId, userId, day)) {
      const count = await getLikeCount(postId);
      return new Response(
        JSON.stringify({
          error: "今天已经点过赞了，明天再来吧",
          liked: false,
          count,
          likeCount: count,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }
    const claimed = await claimPostDailyLike(c, postId, userId, day, now);
    if (!claimed) {
      const count = await getLikeCount(postId);
      return new Response(
        JSON.stringify({
          error: "今天已经点过赞了，明天再来吧",
          liked: false,
          count,
          likeCount: count,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }
  } catch {
    return new Response(JSON.stringify({ error: "点赞失败" }), { status: 500 });
  }
  const lid = `pl_${now}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await c.execute({
      sql: "INSERT INTO post_likes (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)",
      args: [lid, postId, userId, now],
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      // 并发重复请求：配额已占、活跃行已存在，视为已点赞
      const count = await getLikeCount(postId);
      return new Response(
        JSON.stringify({ liked: true, count, likeCount: count }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: "点赞失败" }), { status: 500 });
  }
  // 确认写入真正落盘
  try {
    const verify = await c.execute({
      sql: "SELECT id FROM post_likes WHERE id=?",
      args: [lid],
    });
    if ((verify.rows?.length ?? 0) === 0) {
      return new Response(JSON.stringify({ error: "点赞失败" }), {
        status: 500,
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "点赞失败" }), { status: 500 });
  }
  const count = await getLikeCount(postId);
  return new Response(
    JSON.stringify({ liked: true, count, likeCount: count }),
    { headers: { "Content-Type": "application/json" } },
  );
};
