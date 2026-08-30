import type { APIRoute } from "astro";
import { createDb } from "../../db/client";
import { searchPosts } from "../../db/search";
export const prerender = false;
export const GET: APIRoute = async (ctx) => {
  const q = new URL(ctx.request.url).searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(20, parseInt(new URL(ctx.request.url).searchParams.get("limit") ?? "20", 10) || 20);
  if (!q) return new Response(JSON.stringify({ results: [] }), { headers: { "Content-Type": "application/json" } });
  const env: any = (ctx.locals as any)?.runtime?.env ?? {};
  if (!env.DB) return new Response(JSON.stringify({ results: [], error: "DB not configured" }), { headers: { "Content-Type": "application/json" } });
  const db = createDb(env.DB);
  // searchPosts expects raw D1 client, but drizzle's db.$client is the D1Database
  const rawDb = (db as any).$client ?? env.DB;
  const results = await searchPosts(rawDb, q, limit).catch(async () => {
    // fallback simple LIKE
    const res = await env.DB.prepare("SELECT id, slug, title, excerpt FROM posts WHERE title LIKE ? OR excerpt LIKE ? LIMIT ?").bind(`%${q}%`, `%${q}%`, limit).all();
    return (res.results ?? res) as any[];
  });
  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
};
