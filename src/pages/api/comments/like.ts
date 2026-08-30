import type { APIRoute } from "astro";
export const prerender = false;

// Re-export like handling via main comments module logic (POST /api/comments/like)
export const POST: APIRoute = async (ctx) => {
  const env: any = (ctx.locals as any)?.runtime?.env ?? {};
  if (!env.DB)
    return new Response(JSON.stringify({ error: "DB not configured" }), {
      status: 500,
    });
  const body: any = await ctx.request.json().catch(() => ({}));
  const commentId = body.commentId ?? body.id;
  if (!commentId)
    return new Response(JSON.stringify({ error: "commentId required" }), {
      status: 400,
    });
  let userId: string | null = null;
  try {
    const { createAuth } = await import("../../../auth");
    const auth = createAuth(env);
    const session = await auth.api.getSession({ headers: ctx.request.headers });
    userId =
      (session as any)?.user?.id ?? (session as any)?.session?.userId ?? null;
  } catch {}
  if (!userId)
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  const d1: D1Database = env.DB;
  const rid = `r_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  try {
    await d1
      .prepare(
        "INSERT INTO comment_reactions (id, comment_id, user_id, type) VALUES (?, ?, ?, 'like')",
      )
      .bind(rid, commentId, userId)
      .run();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      await d1
        .prepare(
          "DELETE FROM comment_reactions WHERE comment_id=? AND user_id=?",
        )
        .bind(commentId, userId)
        .run();
      const cnt = await d1
        .prepare(
          "SELECT COUNT(*) as c FROM comment_reactions WHERE comment_id=?",
        )
        .bind(commentId)
        .first<{ c: number }>();
      return new Response(
        JSON.stringify({ ok: true, liked: false, likeCount: cnt?.c ?? 0 }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: "Failed" }), { status: 500 });
  }
  const cnt = await d1
    .prepare("SELECT COUNT(*) as c FROM comment_reactions WHERE comment_id=?")
    .bind(commentId)
    .first<{ c: number }>();
  return new Response(
    JSON.stringify({ ok: true, liked: true, likeCount: cnt?.c ?? 1 }),
    { headers: { "Content-Type": "application/json" } },
  );
};
