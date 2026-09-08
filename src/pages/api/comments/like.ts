import type { APIRoute } from "astro";
import { auth } from "../../../auth";
import {
  extractUserId,
  requireCommentId,
  toggleCommentLike,
} from "../../../lib/commentLike";

export const prerender = false;

interface LikeBody {
  commentId?: unknown;
  id?: unknown;
}

export const POST: APIRoute = async (ctx) => {
  let body: LikeBody = {};
  try {
    body = (await ctx.request.json()) as LikeBody;
  } catch {
    body = {};
  }
  const rawId = body.commentId ?? body.id;
  if (!requireCommentId(rawId))
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
  return toggleCommentLike(rawId, userId);
};
