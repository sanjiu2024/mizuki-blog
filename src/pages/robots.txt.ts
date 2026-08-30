export const prerender = false;

export async function GET(context: any) {
  const site: string =
    context.site?.toString() ?? "https://mizuki-blog.workers.dev";
  const base = site.replace(/\/$/, "");
  const body = `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
