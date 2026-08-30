import type { MiddlewareHandler } from "astro";
export const onRequest: MiddlewareHandler = async (context, next) => {
  // Attach runtime env to locals for convenience
  const runtime: any = (context.locals as any)?.runtime;
  // Better-auth session check is done in API routes, not here globally
  // Keep middleware light to avoid per-request D1 cost
  return next();
};
