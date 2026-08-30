import type { APIRoute } from "astro";
import { seedData } from "../../db/seed";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "20", 10) || 20,
    50,
  );
  const offset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;

  let posts: any[] = [];
  let total = 0;

  try {
    const runtime: any = (locals as any)?.runtime;
    const env = runtime?.env ?? (locals as any)?.env ?? {};
    const db: D1Database | undefined = env.DB;

    if (db) {
      const cnt = await db
        .prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published'")
        .first<{ cnt: number }>();
      total = cnt?.cnt ?? 0;
      const res = await db
        .prepare(
          "SELECT id, slug, title, excerpt, content, status, published_at as publishedAt, created_at as createdAt FROM posts WHERE status='published' ORDER BY published_at DESC, created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(limit, offset)
        .all();
      posts = ((res.results ?? res) as any[]) ?? [];
      total = total || posts.length;
    } else {
      throw new Error("no DB");
    }
  } catch {
    const all = seedData.posts;
    total = all.length;
    posts = all.slice(offset, offset + limit).map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      content: p.content,
      status: p.status,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
    }));
  }

  return new Response(
    JSON.stringify({ posts, total, limit, offset }, null, 2),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
};
