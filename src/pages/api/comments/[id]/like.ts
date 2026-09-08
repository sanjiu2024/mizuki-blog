import type { APIRoute } from "astro";
import { auth } from "../../../../auth";
import {
  extractUserId,
  requireCommentId,
  toggleCommentLike,
} from "../../../../lib/commentLike";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const commentId = ctx.params.id;
  if (!requireCommentId(commentId))
    return new Response(JSON.stringify({ error: "缺少 commentId 参数" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
    });
  return toggleCommentLike(commentId, userId);
};
