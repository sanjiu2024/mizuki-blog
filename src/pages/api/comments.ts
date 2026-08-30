import type { APIRoute } from "astro";
import { createDb } from "../../db/client";
import { comments } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const postId = url.searchParams.get("postId") ?? url.searchParams.get("post_id");
  if (!postId) return new Response(JSON.stringify({ error: "postId required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  const env: any = (ctx.locals as any)?.runtime?.env ?? {};
  if (!env.DB) return new Response(JSON.stringify({ error: "DB not configured" }), { status: 500 });
  const db = createDb(env.DB);
  const rows = await db.select().from(comments).where(eq(comments.postId, postId)).orderBy(desc(comments.createdAt));
  return new Response(JSON.stringify({ comments: rows }), { headers: { "Content-Type": "application/json" } });
};

export const POST: APIRoute = async (ctx) => {
  const env: any = (ctx.locals as any)?.runtime?.env ?? {};
  if (!env.DB) return new Response(JSON.stringify({ error: "DB not configured" }), { status: 500 });
  // auth check via better-auth session
  let userId: string | null = null;
  try {
    const { createAuth } = await import("../../auth");
    const auth = createAuth(env);
    const session = await auth.api.getSession({ headers: ctx.request.headers });
    userId = (session as any)?.user?.id ?? (session as any)?.session?.userId ?? null;
  } catch {}
  // Allow anonymous if you want, but require login per spec
  if (!userId) return new Response(JSON.stringify({ error: "Unauthorized - please login" }), { status: 401 });

  const body: any = await ctx.request.json().catch(()=> ({}));
  const { postId, content, parentId } = body;
  if (!postId || !content?.trim()) return new Response(JSON.stringify({ error: "postId and content required" }), { status: 400 });

  const db = createDb(env.DB);
  const id = `c_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  await db.insert(comments).values({ id, postId, authorId: userId, parentId: parentId ?? null, content: content.trim(), status: "approved", createdAt: Date.now() });
  return new Response(JSON.stringify({ ok: true, id }), { status: 201, headers: { "Content-Type": "application/json" } });
};
