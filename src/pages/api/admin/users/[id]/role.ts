import type { APIRoute } from "astro";
import { auth } from "../../../../../auth";
import { ASSIGNABLE_ROLES, normalizeRole } from "../../../../../lib/rbac";

export const prerender = false;

function isAssignable(v: unknown): v is (typeof ASSIGNABLE_ROLES)[number] {
  return (
    typeof v === "string" &&
    (ASSIGNABLE_ROLES as readonly string[]).includes(v)
  );
}

export const POST: APIRoute = async (ctx) => {
  let sessionData: { user?: { id?: string } } | null = null;
  try {
    sessionData = await (auth as unknown as {
      api: {
        getSession: (args: {
          headers: Headers;
        }) => Promise<{ user?: { id?: string } } | null>;
      };
    }).api.getSession({ headers: ctx.request.headers });
  } catch {
    return new Response(JSON.stringify({ error: "未登录，请先登录" }), {
      status: 401,
    });
  }
  const requesterId = sessionData?.user?.id;
  if (!requesterId) {
    return new Response(JSON.stringify({ error: "未登录，请先登录" }), {
      status: 401,
    });
  }

  const { db } = await import("../../../../../db/client");
  const exec = (
    sql: string,
    args: (string | number | null)[],
  ): Promise<{ rows: Record<string, unknown>[] }> =>
    (db.$client.execute({ sql, args }) as unknown as Promise<{
      rows: Record<string, unknown>[];
    }>);

  const owners = await exec("SELECT role FROM users WHERE id = ?", [
    requesterId,
  ]);
  if (normalizeRole(owners.rows[0]?.role) !== "super_admin") {
    return new Response(JSON.stringify({ error: "仅超级管理员可访问" }), {
      status: 403,
    });
  }

  const targetId = ctx.params.id;
  if (!targetId) {
    return new Response(JSON.stringify({ error: "缺少用户 id" }), {
      status: 400,
    });
  }

  let body: { role?: unknown } = {};
  try {
    body = (await ctx.request.json()) as { role?: unknown };
  } catch {
    return new Response(JSON.stringify({ error: "请求体格式错误" }), {
      status: 400,
    });
  }
  if (!isAssignable(body.role)) {
    return new Response(
      JSON.stringify({
        error: `无效的角色，只能是 ${ASSIGNABLE_ROLES.join("、")} 之一`,
      }),
      { status: 400 },
    );
  }

  if (targetId === requesterId && body.role !== "super_admin") {
    return new Response(
      JSON.stringify({ error: "不能降级自己的超级管理员账号" }),
      { status: 403 },
    );
  }

  const targets = await exec("SELECT id, role FROM users WHERE id = ?", [
    targetId,
  ]);
  if (targets.rows.length === 0) {
    return new Response(JSON.stringify({ error: "用户不存在" }), {
      status: 404,
    });
  }

  if (
    normalizeRole(targets.rows[0].role) === "super_admin" &&
    body.role !== "super_admin"
  ) {
    const rest = await exec(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND id != ?",
      [targetId],
    );
    if (Number(rest.rows[0]?.n ?? 0) === 0) {
      return new Response(
        JSON.stringify({ error: "不能降级最后一位超级管理员" }),
        { status: 403 },
      );
    }
  }

  await exec("UPDATE users SET role = ? WHERE id = ?", [body.role, targetId]);
  return new Response(JSON.stringify({ ok: true, id: targetId, role: body.role }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
