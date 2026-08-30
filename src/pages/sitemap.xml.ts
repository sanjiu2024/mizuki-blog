export const prerender = false;

import { createDb } from "../db/client";
import { seedData } from "../db/seed";

export async function GET(context: any) {
  const site: string =
    context.site?.toString() ?? "https://mizuki-blog.workers.dev";
  const base = site.replace(/\/$/, "");

  let urls: string[] = [];

  try {
    const db = createDb(context.locals.runtime.env.DB);
    const posts: any[] = await db.query.posts.findMany({
      where: (p: any, { eq }: any) => eq(p.status, "published"),
      columns: { slug: true, publishedAt: true },
    });
    urls = posts.map((p: any) => {
      const lastmod = p.publishedAt
        ? new Date(p.publishedAt).toISOString()
        : new Date().toISOString();
      return `  <url><loc>${base}/posts/${p.slug}/</loc><lastmod>${lastmod}</lastmod></url>`;
    });
  } catch {
    // fallback to seedData
    urls = seedData.posts
      .filter((p) => p.status === "published")
      .map((p) => {
        const lastmod = p.publishedAt
          ? new Date(p.publishedAt).toISOString()
          : new Date().toISOString();
        return `  <url><loc>${base}/posts/${p.slug}/</loc><lastmod>${lastmod}</lastmod></url>`;
      });
  }

  // Also include homepage
  const staticUrls = [
    `  <url><loc>${base}/</loc><lastmod>${new Date().toISOString()}</lastmod></url>`,
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...staticUrls, ...urls].join("\n")}\n</urlset>`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
