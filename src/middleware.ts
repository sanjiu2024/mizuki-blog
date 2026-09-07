import type { MiddlewareHandler } from "astro";
import { auth } from "./auth";

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
        if (row?.role) user.role = row.role;
        else if (!user.role) user.role = "user";
      } catch {
        if (!user.role) user.role = "user";
      }
    }
    (context.locals as any).user = user;
    (context.locals as any).session = sessionData?.session ?? null;
  } catch {
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
