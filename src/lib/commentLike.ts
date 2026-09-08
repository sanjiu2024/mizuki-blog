import { db } from "../db/client";
import {
  claimCommentDailyLike,
  countCommentLikes,
  ensureCommentLikeTables,
  hasCommentLikedToday,
  todayKey,
  type ExecClient,
} from "./likeDaily";

interface SessionLike {
  user?: { id?: string | null } | null;
  session?: { userId?: string | null } | null;
}

export function extractUserId(session: unknown): string | null {
  if (typeof session !== "object" || session === null) return null;
  const s = session as SessionLike;
  return s.user?.id ?? s.session?.userId ?? null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function requireCommentId(commentId: unknown): commentId is string {
  return typeof commentId === "string" && commentId.length > 0;
}

export async function toggleCommentLike(
  commentId: string,
  userId: string,
): Promise<Response> {
  const c = db.$client as unknown as ExecClient;
  try {
    await ensureCommentLikeTables(c);
  } catch {
    return json({ error: "点赞失败" }, 500);
  }
  try {
    const existing = await c.execute({
      sql: "SELECT id FROM comment_reactions WHERE comment_id=? AND user_id=?",
      args: [commentId, userId],
    });
    if ((existing.rows?.length ?? 0) > 0) {
      await c.execute({
        sql: "DELETE FROM comment_reactions WHERE comment_id=? AND user_id=?",
        args: [commentId, userId],
      });
      const likeCount = await safeCount(c, commentId);
      return json({ ok: true, liked: false, likeCount });
    }
  } catch {
    return json({ error: "点赞失败" }, 500);
  }
  const day = todayKey();
  const now = Date.now();
  try {
    if (await hasCommentLikedToday(c, commentId, userId, day)) {
      const likeCount = await safeCount(c, commentId);
      return json(
        { error: "今天已经点过赞了，明天再来吧", ok: true, liked: false, likeCount },
        429,
      );
    }
    const claimed = await claimCommentDailyLike(c, commentId, userId, day, now);
    if (!claimed) {
      const likeCount = await safeCount(c, commentId);
      return json(
        { error: "今天已经点过赞了，明天再来吧", ok: true, liked: false, likeCount },
        429,
      );
    }
  } catch {
    return json({ error: "点赞失败" }, 500);
  }
  const rid = `r_${now}_${Math.random().toString(36).slice(2, 5)}`;
  try {
    await c.execute({
      sql: "INSERT INTO comment_reactions (id, comment_id, user_id, type, created_at) VALUES (?, ?, ?, 'like', ?)",
      args: [rid, commentId, userId, now],
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      const likeCount = await safeCount(c, commentId);
      return json({ ok: true, liked: true, likeCount });
    }
    return json({ error: "点赞失败" }, 500);
  }
  try {
    const verify = await c.execute({
      sql: "SELECT id FROM comment_reactions WHERE id=?",
      args: [rid],
    });
    if ((verify.rows?.length ?? 0) === 0) {
      return json({ error: "点赞失败" }, 500);
    }
  } catch {
    return json({ error: "点赞失败" }, 500);
  }
  const likeCount = await safeCount(c, commentId);
  return json({ ok: true, liked: true, likeCount });
}

async function safeCount(c: ExecClient, commentId: string): Promise<number> {
  try {
    return await countCommentLikes(c, commentId);
  } catch {
    return 0;
  }
}
