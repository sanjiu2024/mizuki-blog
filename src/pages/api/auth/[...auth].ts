import type { APIRoute } from "astro";
import { createAuth } from "../../../auth";

export const prerender = false;

const handler: APIRoute = async (ctx) => {
  const env = (ctx.locals as any).runtime?.env ?? {};
  const auth = createAuth(env);
  return auth.handler(ctx.request);
};

export const GET: APIRoute = handler;
export const POST: APIRoute = handler;
