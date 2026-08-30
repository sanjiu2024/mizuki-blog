import type { APIRoute } from "astro";
import { createAuth } from "../../../auth";

const handler: APIRoute = async (ctx) => {
  const env = (ctx.locals as any).runtime?.env ?? (ctx as any).env ?? {};
  // fallback for wrangler dev where env is on locals.runtime.env
  const runtimeEnv = env.DB ? env : ((ctx.locals as any).runtime?.env ?? {});
  const authEnv = runtimeEnv.DB ? runtimeEnv : env;
  const auth = createAuth(authEnv);
  return auth.handler(ctx.request);
};

export const GET: APIRoute = handler;
export const POST: APIRoute = handler;
