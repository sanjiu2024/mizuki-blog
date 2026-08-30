import type { APIRoute } from "astro";
import { createAuth } from "../../../auth";

export const prerender = false;

const handler: APIRoute = async (ctx) => {
  try {
    // 官方推荐：优先 cloudflare:workers，其次 Astro.locals.runtime（兼容旧代码）
    let env: any = {};
    try {
      const { env: cfEnv } = await import("cloudflare:workers");
      if ((cfEnv as any)?.DB) env = cfEnv as any;
    } catch {}
    if (!env?.DB) {
      env = (ctx.locals as any).runtime?.env ?? (ctx as any).env ?? env;
    }
    const auth = createAuth(env);
    return await auth.handler(ctx.request);
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        error: e?.message ?? String(e),
        code: "AUTH_INIT_FAILED",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};

export const GET: APIRoute = handler;
export const POST: APIRoute = handler;
