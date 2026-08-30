import type { MiddlewareHandler } from "astro";
import { createAuth } from "./auth";

export const onRequest: MiddlewareHandler = async (context, next) => {
  const runtime: any = (context.locals as any)?.runtime;
  const env = runtime?.env ?? {};
  const url = new URL(context.request.url);

  let sessionData: any = null;
  let user: any = null;

  try {
    if (env.DB) {
      const auth = createAuth(env);
      // better-auth getSession expects headers
      sessionData = await (auth as any).api.getSession({
        headers: context.request.headers,
      });
      user = sessionData?.user ?? null;
      // If custom role column exists, supplement from D1 (better-auth may not include it)
      if (user?.id && env.DB) {
        try {
          const row = (await env.DB.prepare(
            "SELECT role FROM users WHERE id = ?",
          )
            .bind(user.id)
            .first()) as { role: string } | null;
          if (row?.role) {
            user.role = row.role;
          } else if (!user.role) {
            user.role = "user";
          }
        } catch {
          if (!user.role) user.role = "user";
        }
      }
      // expose to locals for pages / API routes
      (context.locals as any).user = user;
      (context.locals as any).session = sessionData?.session ?? null;
    }
  } catch {
    // keep unauthenticated
    (context.locals as any).user = null;
    (context.locals as any).session = null;
  }

  // Admin protection
  if (url.pathname.startsWith("/admin")) {
    if (!user) {
      return context.redirect("/login", 302);
    }
    const role = user.role ?? "user";
    if (role !== "admin") {
      return new Response("Forbidden — admin only", { status: 403 });
    }
  }

  return next();
};
