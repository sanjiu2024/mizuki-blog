import type { APIRoute } from "astro";
import { db } from "../../../db/client";
import { auth } from "../../../auth";
export const prerender = false;

// Re-export like handling via main comments module logic (POST /api/comments/like)
export const POST: APIRoute = async (ctx) => {
  const body: any = await ctx.request.json().catch(() => ({}));
  const commentId = body.commentId ?? body.id;
  if (!commentId)
    return new Response(JSON.stringify({ error: "commentId required" }), {
      status: 400,
    });
  let userId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: ctx.request.headers });
    userId =
      (session as any)?.user?.id ?? (session as any)?.session?.userId ?? null;
  } catch {}
  if (!userId)
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  const rid = `r_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  try {
    await db.$client.execute({
      sql: "INSERT INTO comment_reactions (id, comment_id, user_id, type) VALUES (?, ?, ?, 'like')",
      args: [rid, commentId, userId],
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
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
    return new Response(JSON.stringify({ error: "Failed" }), { status: 500 });
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
};
