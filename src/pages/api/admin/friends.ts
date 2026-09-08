import type { APIRoute } from "astro";
import { auth } from "../../../auth";
import { normalizeRole } from "../../../lib/rbac";
import { db } from "../../../db/client";
import { nanoid } from "nanoid";

export const prerender = false;

const URL_RE = /^https?:\/\/[^\s]{1,500}$/;
const AVATAR_RE = /^(https?:\/\/|\/)[^\s]{1,500}$/;

type SessionUser = { id: string; role: string };

async function requirePrivileged(request: Request): Promise<{
  user: SessionUser | null;
  error: Response | null;
}> {
  let sessionData: { user?: { id?: string } } | null = null;
  try {
    sessionData = await (
      auth as unknown as {
        api: {
          getSession: (args: {
            headers: Headers;
          }) => Promise<{ user?: { id?: string } } | null>;
        };
      }
    ).api.getSession({ headers: request.headers });
  } catch {
    return {
      user: null,
      error: new Response(JSON.stringify({ error: "未登录，请先登录" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  const requesterId = sessionData?.user?.id;
  if (!requesterId) {
    return {
      user: null,
      error: new Response(JSON.stringify({ error: "未登录，请先登录" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  const rs = await db.$client.execute({
    sql: "SELECT role FROM users WHERE id = ?",
    args: [requesterId],
  });
  const role = normalizeRole(
    (rs.rows[0] as unknown as { role?: unknown } | undefined)?.role,
  );
  if (role !== "admin" && role !== "super_admin") {
    return {
      user: null,
      error: new Response(
        JSON.stringify({ error: "仅管理员和超级管理员可管理友情链接" }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    };
  }
  return { user: { id: requesterId, role }, error: null };
}

function validateInput(body: Record<string, unknown>): string | null {
  const name = String(body.name ?? "").trim();
  const url = String(body.url ?? "").trim();
  if (!name) return "请填写网站名称";
  if (name.length > 100) return "网站名称过长（最多 100 字符）";
  if (!url || !URL_RE.test(url)) return "链接必须是 http(s) 开头的有效 URL";
  const description = String(body.description ?? "");
  if (description.length > 500) return "描述过长（最多 500 字符）";
  const avatar = String(body.avatar ?? "").trim();
  if (avatar && !AVATAR_RE.test(avatar))
    return "头像必须是 http(s) URL 或 / 开头的站内路径";
  const sort = body.sort;
  if (
    sort !== undefined &&
    sort !== null &&
    String(sort).trim() !== "" &&
    !Number.isInteger(Number(sort))
  )
    return "排序必须是整数";
  return null;
}

function normalizeSort(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) ? n : 0;
}

function normalizeOptional(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export const POST: APIRoute = async ({ request }) => {
  const gate = await requirePrivileged(request);
  if (gate.error) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "请求体格式错误" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const err = validateInput(body);
  if (err)
    return new Response(JSON.stringify({ error: err }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  const id = nanoid(12);
  const now = Date.now();
  await db.$client.execute({
    sql: "INSERT INTO friends (id, name, url, description, avatar, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      id,
      String(body.name).trim(),
      String(body.url).trim(),
      normalizeOptional(body.description),
      normalizeOptional(body.avatar),
      normalizeSort(body.sort),
      now,
      now,
    ],
  });
  return new Response(JSON.stringify({ ok: true, id }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
};

export const PATCH: APIRoute = async ({ request }) => {
  const gate = await requirePrivileged(request);
  if (gate.error) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "请求体格式错误" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const id = String(body.id ?? "").trim();
  if (!id)
    return new Response(JSON.stringify({ error: "缺少 id 参数" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  const existing = await db.$client.execute({
    sql: "SELECT id FROM friends WHERE id = ?",
    args: [id],
  });
  if (existing.rows.length === 0)
    return new Response(JSON.stringify({ error: "友情链接不存在" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 100)
      return new Response(JSON.stringify({ error: "请填写网站名称" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    fields.push("name = ?");
    values.push(name);
  }
  if (body.url !== undefined) {
    const url = String(body.url).trim();
    if (!URL_RE.test(url))
      return new Response(
        JSON.stringify({ error: "链接必须是 http(s) 开头的有效 URL" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    fields.push("url = ?");
    values.push(url);
  }
  if (body.description !== undefined) {
    const d = String(body.description);
    if (d.length > 500)
      return new Response(JSON.stringify({ error: "描述过长" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    fields.push("description = ?");
    values.push(normalizeOptional(body.description));
  }
  if (body.avatar !== undefined) {
    const a = String(body.avatar).trim();
    if (a && !AVATAR_RE.test(a))
      return new Response(JSON.stringify({ error: "头像格式不正确" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    fields.push("avatar = ?");
    values.push(normalizeOptional(body.avatar));
  }
  if (body.sort !== undefined) {
    if (
      String(body.sort).trim() !== "" &&
      !Number.isInteger(Number(body.sort))
    )
      return new Response(JSON.stringify({ error: "排序必须是整数" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    fields.push("sort = ?");
    values.push(normalizeSort(body.sort));
  }
  fields.push("updated_at = ?");
  values.push(Date.now());
  values.push(id);

  if (fields.length > 1) {
    await db.$client.execute({
      sql: `UPDATE friends SET ${fields.join(", ")} WHERE id = ?`,
      args: values,
    });
  }
  return new Response(JSON.stringify({ ok: true, id }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const gate = await requirePrivileged(request);
  if (gate.error) return gate.error;

  let id: string | null = url.searchParams.get("id");
  if (!id) {
    try {
      const body = (await request.json()) as { id?: unknown };
      id = body?.id ? String(body.id) : null;
    } catch {
      id = null;
    }
  }
  if (!id)
    return new Response(JSON.stringify({ error: "缺少 id 参数" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  await db.$client.execute({
    sql: "DELETE FROM friends WHERE id = ?",
    args: [id],
  });
  return new Response(JSON.stringify({ ok: true, id }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
