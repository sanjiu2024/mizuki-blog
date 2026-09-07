import type { APIRoute } from "astro";
import { db } from "../../db/client";
import { searchPosts } from "../../db/search";
export const prerender = false;
export const GET: APIRoute = async (ctx) => {
  const q = new URL(ctx.request.url).searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    20,
    parseInt(new URL(ctx.request.url).searchParams.get("limit") ?? "20", 10) ||
      20,
  );
  if (!q)
    return new Response(JSON.stringify({ results: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  const results = await searchPosts(db, q, limit).catch(async () => {
    const rs = await db.$client.execute({
      sql: "SELECT id, slug, title, excerpt FROM posts WHERE title LIKE ? OR excerpt LIKE ? LIMIT ?",
      args: [`%${q}%`, `%${q}%`, limit],
    });
    return (rs.rows ?? []) as any[];
  });
  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
};
