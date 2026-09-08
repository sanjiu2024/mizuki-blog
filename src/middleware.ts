import type { MiddlewareHandler } from "astro";
import { auth } from "./auth";
import { canAccess, normalizeRole } from "./lib/rbac";

export const onRequest: MiddlewareHandler = async (context, next) => {
  const url = new URL(context.request.url);
  let sessionData: any = null;
  let user: any = null;
  try {
    sessionData = await (auth as any).api.getSession({
      headers: context.request.headers,
    });
    user = sessionData?.user ?? null;
    if (user?.id) {
      try {
        const { db } = await import("./db/client");
        const row = await (db as any).query.users.findFirst({
          where: (u: any, { eq }: any) => eq(u.id, user.id),
        });
        user.role = normalizeRole(row?.role ?? user.role);
      } catch {
        user.role = normalizeRole(user.role);
      }
    }
    (context.locals as any).user = user;
    (context.locals as any).session = sessionData?.session ?? null;
  } catch {
    (context.locals as any).user = null;
    (context.locals as any).session = null;
  }

  if (
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/author") ||
    url.pathname.startsWith("/inspector") ||
    url.pathname.startsWith("/super") ||
    url.pathname.startsWith("/api/admin")
  ) {
    if (!user) {
      return context.redirect("/login", 302);
    }
    if (!canAccess(user.role, url.pathname)) {
      return new Response("权限不足，无法访问", { status: 403 });
    }
  }

  return next();
};
