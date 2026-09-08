import type { APIRoute } from "astro";
import { seedData } from "../../db/seed";
import { db } from "../../db/client";
import { auth } from "../../auth";
import { POST_CATEGORIES } from "../../db/schema";
import { nanoid } from "nanoid";

export const prerender = false;

const SLUG_RE = /^[a-z0-9-]+$/;
const COVER_RE = /^(https?:\/\/|\/)[^\s]{1,500}$/;

async function first(sqlText: string, args: unknown[]): Promise<any> {
  const rs = await db.$client.execute({ sql: sqlText, args: args as any[] });
  return (rs.rows?.[0] ?? null) as any;
}

async function all(sqlText: string, args: unknown[]): Promise<any[]> {
  const rs = await db.$client.execute({ sql: sqlText, args: args as any[] });
  return rs.rows as unknown as any[];
}

async function run(sqlText: string, args: unknown[]): Promise<void> {
  await db.$client.execute({ sql: sqlText, args: args as any[] });
}

async function getSessionUser(request: Request) {
  try {
    const data: any = await (auth as any).api.getSession({
      headers: request.headers,
    });
    const user = data?.user ?? null;
    if (!user) return null;
    // supplement role from db
    try {
      const row = (await first("SELECT role FROM users WHERE id=?", [
        user.id,
      ])) as { role: string } | null;
      if (row?.role) user.role = row.role;
      else if (!user.role) user.role = "user";
    } catch {
      if (!user.role) user.role = "user";
    }
    return user;
  } catch {
    return null;
  }
}

type SessionUser = { id: string; role: string; [key: string]: unknown };

async function requireWriter(request: Request) {
  const user = (await getSessionUser(request)) as SessionUser | null;
  if (!user) {
    return {
      user: null,
      error: new Response(JSON.stringify({ error: "未登录，请先登录" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  if (!["author", "admin", "super_admin"].includes(user.role)) {
    return {
      user: null,
      error: new Response(JSON.stringify({ error: "无权限访问" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  return { user, error: null as unknown as Response };
}

function isPrivileged(role: string): boolean {
  return role === "admin" || role === "super_admin";
}

function ownershipError() {
  return new Response(
    JSON.stringify({ error: "无权操作他人的文章" }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
}

function validateBody(body: any) {
  const errors: string[] = [];
  if (!body.title || typeof body.title !== "string" || !body.title.trim())
    errors.push("请填写标题");
  if (!body.content || typeof body.content !== "string" || !body.content.trim())
    errors.push("请填写正文");
  if (!body.slug || typeof body.slug !== "string" || !SLUG_RE.test(body.slug))
    errors.push("Slug 格式不正确，仅允许小写字母、数字和连字符");
  if (body.status && !["published", "draft"].includes(body.status))
    errors.push("状态只能是“已发布”或“草稿”");
  if (
    body.cover !== undefined &&
    body.cover !== null &&
    String(body.cover).trim() !== "" &&
    !COVER_RE.test(String(body.cover).trim())
  )
    errors.push("封面必须是 http(s) URL 或 / 开头的站内路径");
  if (
    body.category !== undefined &&
    body.category !== null &&
    String(body.category).trim() !== "" &&
    !(POST_CATEGORIES as readonly string[]).includes(String(body.category).trim())
  )
    errors.push(`分类只能是 ${POST_CATEGORIES.join(" / ")}`);
  return errors;
}

function normalizeCover(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  const s = String(input).trim();
  return s === "" ? null : s;
}

function normalizeCategory(input: unknown): string {
  const s = String(input ?? "未分类").trim();
  if ((POST_CATEGORIES as readonly string[]).includes(s)) return s;
  return "未分类";
}

// ── tolerant column detection (DB may not be migrated yet) ──
let postColsCache: Set<string> | null = null;
async function postColumns(): Promise<Set<string>> {
  if (postColsCache) return postColsCache;
  try {
    const rs = await db.$client.execute({
      sql: "PRAGMA table_info(posts)",
      args: [],
    });
    const cols = new Set<string>();
    for (const r of rs.rows as unknown as Array<Record<string, unknown>>) {
      const name = String(r.name ?? "");
      if (name) cols.add(name);
    }
    postColsCache = cols;
    return cols;
  } catch {
    return new Set<string>([
      "id",
      "slug",
      "title",
      "excerpt",
      "content",
      "status",
      "author_id",
      "published_at",
      "created_at",
      "updated_at",
    ]);
  }
}

function parseTags(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input))
    return input.map((s) => String(s).trim()).filter(Boolean);
  if (typeof input === "string")
    return input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

function slugifyTag(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || name.toLowerCase().trim()
  );
}

async function syncPostTags(postId: string, tags: string[]) {
  // delete old
  await run("DELETE FROM post_tags WHERE post_id=?", [postId]);
  for (const raw of tags) {
    const name = raw.trim();
    if (!name) continue;
    const slug = slugifyTag(name);
    // find existing tag by slug or name
    const tagRow = (await first("SELECT id FROM tags WHERE slug=? OR name=?", [
      slug,
      name,
    ])) as { id: string } | null;
    let tagId = tagRow?.id;
    if (!tagId) {
      tagId = nanoid(10);
      try {
        await run("INSERT INTO tags (id, name, slug) VALUES (?,?,?)", [
          tagId,
          name,
          slug,
        ]);
      } catch {
        // if slug conflict try fetch again
        const again = (await first("SELECT id FROM tags WHERE slug=?", [
          slug,
        ])) as { id: string } | null;
        if (again?.id) tagId = again.id;
        else continue;
      }
    }
    await run(
      "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?,?)",
      [postId, tagId],
    );
  }
}

// ── GET (保留) ──
export const GET: APIRoute = async ({ url, request }) => {
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "20", 10) || 20,
    50,
  );
  const offset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;
  const mine = url.searchParams.get("mine") === "1";

  // author (and admin) can list own posts via ?mine=1
  if (mine) {
    const gate = await requireWriter(request);
    if (gate.error) return gate.error;
    const user = gate.user as SessionUser;
    const cols = await postColumns();
    const extra = [
      cols.has("cover") ? "cover," : "",
      cols.has("category") ? "category," : "",
    ].join(" ");
    const minePosts: unknown[] = await all(
      `SELECT id, slug, title, excerpt, content, ${extra} status, published_at as publishedAt, created_at as createdAt FROM posts WHERE author_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [user.id, limit, offset],
    );
    const cnt = await first(
      "SELECT COUNT(*) as cnt FROM posts WHERE author_id=?",
      [user.id],
    );
    const totalMine = Number(
      (cnt as { cnt: number | string } | null)?.cnt ?? minePosts.length,
    );
    return new Response(
      JSON.stringify(
        { posts: minePosts, total: totalMine, limit, offset },
        null,
        2,
      ),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }

  let posts: any[] = [];
  let total = 0;

  try {
    const cnt = await first(
      "SELECT COUNT(*) as cnt FROM posts WHERE status='published'",
      [],
    );
    total = Number(cnt?.cnt ?? 0);
    const cols = await postColumns();
    const extra = [
      cols.has("cover") ? "cover," : "",
      cols.has("category") ? "category," : "",
    ].join(" ");
    posts = await all(
      `SELECT id, slug, title, excerpt, content, ${extra} status, published_at as publishedAt, created_at as createdAt FROM posts WHERE status='published' ORDER BY published_at DESC, created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    total = total || posts.length;
  } catch {
    const allPosts = seedData.posts;
    total = allPosts.length;
    posts = allPosts.slice(offset, offset + limit).map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      content: p.content,
      status: p.status,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
    }));
  }

  return new Response(
    JSON.stringify({ posts, total, limit, offset }, null, 2),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
};

// ── POST ──
export const POST: APIRoute = async ({ request }) => {
  const gate = await requireWriter(request);
  if (gate.error) return gate.error;
  const user = gate.user as SessionUser;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求格式错误" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const errors = validateBody(body);
  if (errors.length)
    return new Response(JSON.stringify({ error: errors.join("; ") }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  const tags = parseTags(body.tags);
  const id = nanoid(12);
  const now = Date.now();
  const publishedAt = body.status === "draft" ? null : now;
  const cover = normalizeCover(body.cover);
  const category = normalizeCategory(body.category);

  try {
    const cols = await postColumns();
    const columns = [
      "id",
      "slug",
      "title",
      "excerpt",
      "content",
      ...(cols.has("cover") ? ["cover"] : []),
      ...(cols.has("category") ? ["category"] : []),
      "status",
      "author_id",
      "published_at",
      "created_at",
      "updated_at",
    ];
    const values: unknown[] = [
      id,
      body.slug,
      body.title.trim(),
      body.excerpt ?? null,
      body.content,
      ...(cols.has("cover") ? [cover] : []),
      ...(cols.has("category") ? [category] : []),
      body.status ?? "published",
      user.id,
      publishedAt,
      now,
      now,
    ];
    await run(
      `INSERT INTO posts (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(",")})`,
      values,
    );

    if (tags.length) await syncPostTags(id, tags);

    return new Response(
      JSON.stringify({ id, slug: body.slug, title: body.title }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE") && msg.includes("slug")) {
      return new Response(JSON.stringify({ error: "该 Slug 已存在，请换一个" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

// ── PATCH ──
export const PATCH: APIRoute = async ({ request, url }) => {
  const gate = await requireWriter(request);
  if (gate.error) return gate.error;
  const user = gate.user as SessionUser;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求格式错误" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  // id can come from body.id or query ?id=
  const id = body.id ?? url.searchParams.get("id");
  if (!id)
    return new Response(JSON.stringify({ error: "缺少 id 参数" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  // fetch existing to validate
  const existing = (await first("SELECT id, author_id FROM posts WHERE id=?", [
    id,
  ])) as { id: string; author_id: string } | null;
  if (!existing)
    return new Response(JSON.stringify({ error: "文章不存在" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  if (!isPrivileged(user.role) && existing.author_id !== user.id)
    return ownershipError();

  // validate if fields present
  if (body.slug && !SLUG_RE.test(body.slug))
    return new Response(
      JSON.stringify({ error: "Slug 格式不正确，仅允许小写字母、数字和连字符" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  if (body.title !== undefined && (!body.title || !String(body.title).trim()))
    return new Response(JSON.stringify({ error: "请填写标题" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  if (
    body.content !== undefined &&
    (!body.content || !String(body.content).trim())
  )
    return new Response(JSON.stringify({ error: "请填写正文" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  const now = Date.now();
  const fields: string[] = [];
  const values: any[] = [];
  if (body.title !== undefined) {
    fields.push("title=?");
    values.push(String(body.title).trim());
  }
  if (body.slug !== undefined) {
    fields.push("slug=?");
    values.push(body.slug);
  }
  if (body.excerpt !== undefined) {
    fields.push("excerpt=?");
    values.push(body.excerpt ?? null);
  }
  if (body.cover !== undefined) {
    const cols = await postColumns();
    if (cols.has("cover")) {
      fields.push("cover=?");
      values.push(normalizeCover(body.cover));
    }
  }
  if (body.category !== undefined) {
    const cols = await postColumns();
    if (cols.has("category")) {
      fields.push("category=?");
      values.push(normalizeCategory(body.category));
    }
  }
  if (body.content !== undefined) {
    fields.push("content=?");
    values.push(body.content);
  }
  if (body.status !== undefined) {
    if (!["published", "draft"].includes(body.status))
      return new Response(
        JSON.stringify({ error: "状态只能是“已发布”或“草稿”" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    fields.push("status=?");
    values.push(body.status);
    // if published and no published_at, set now; if draft, keep as is? set published_at accordingly
    if (body.status === "published") {
      const cur = (await first("SELECT published_at FROM posts WHERE id=?", [
        id,
      ])) as { published_at: number | null } | null;
      if (!cur?.published_at) {
        fields.push("published_at=?");
        values.push(now);
      }
    }
  }
  fields.push("updated_at=?");
  values.push(now);
  values.push(id);

  try {
    if (fields.length > 1) {
      await run(`UPDATE posts SET ${fields.join(", ")} WHERE id=?`, values);
    }
    if (body.tags !== undefined) {
      const tags = parseTags(body.tags);
      await syncPostTags(id, tags);
    }
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE") && msg.includes("slug")) {
      return new Response(JSON.stringify({ error: "该 Slug 已存在，请换一个" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

// ── DELETE ──
export const DELETE: APIRoute = async ({ request, url }) => {
  const gate = await requireWriter(request);
  if (gate.error) return gate.error;
  const user = gate.user as SessionUser;

  let id: string | null = url.searchParams.get("id");
  if (!id) {
    try {
      const body: any = await request.json();
      id = body?.id ?? null;
    } catch {}
  }
  if (!id)
    return new Response(JSON.stringify({ error: "缺少 id 参数" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  const existing = (await first("SELECT id, author_id FROM posts WHERE id=?", [
    id,
  ])) as { id: string; author_id: string } | null;
  if (!existing)
    return new Response(JSON.stringify({ error: "文章不存在" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  if (!isPrivileged(user.role) && existing.author_id !== user.id)
    return ownershipError();

  // cascade will delete post_tags via FK, but ensure
  await run("DELETE FROM post_tags WHERE post_id=?", [id]);
  await run("DELETE FROM posts WHERE id=?", [id]);

  return new Response(JSON.stringify({ ok: true, id }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
