import type { APIRoute } from "astro";
import { auth } from "../../../auth";

export const prerender = false;

const handler: APIRoute = async (ctx) => {
  return auth.handler(ctx.request);
};

export const GET: APIRoute = handler;
export const POST: APIRoute = handler;
