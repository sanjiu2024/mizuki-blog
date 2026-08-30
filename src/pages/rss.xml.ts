export const prerender = false;
import rss from "@astrojs/rss";
import { createDb } from "../db/client";

export async function GET(context: any) {
  const db = createDb(context.locals.runtime.env.DB);
  const posts = await db.query.posts.findMany({
    orderBy: (p: any, { desc }: any) => desc(p.publishedAt),
  });
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
