export const prerender = false;
import rss from "@astrojs/rss";
import { db } from "../db/client";
import { seedData } from "../db/seed";

export async function GET(context: any) {
  let posts: any[] = [];
  try {
    posts = await db.query.posts.findMany({
      where: (p: any, { eq }: any) => eq(p.status, "published"),
      orderBy: (p: any, { desc }: any) => desc(p.publishedAt),
      limit: 20,
    });
  } catch {
    posts = seedData.posts
      .filter((p) => p.status === "published")
      .slice(0, 20)
      .map((p) => ({
        title: p.title,
        slug: p.slug,
        excerpt: p.excerpt,
        publishedAt: p.publishedAt,
      }));
  }

  return rss({
    title: "Mizuki Blog",
    description: "Mizuki 动态博客",
    site: context.site,
    items: posts.map((p: any) => ({
      title: p.title,
      pubDate: new Date(p.publishedAt),
      link: `/posts/${p.slug}/`,
      description: p.excerpt,
    })),
  });
}
