import type { APIRoute } from "astro";
import { seedData } from "../../db/seed";
import { createAuth } from "../../auth";
import { nanoid } from "nanoid";

export const prerender = false;

const SLUG_RE = /^[a-z0-9-]+$/;

function getEnv(locals: any) {
  return locals?.runtime?.env ?? (locals as any)?.env ?? {};
}

async function getSessionUser(request: Request, env: any) {
  try {
    if (!env.DB) return null;
    const auth = createAuth(env);
    const data: any = await (auth as any).api.getSession({
      headers: request.headers,
    });
    const user = data?.user ?? null;
    if (!user) return null;
    // supplement role from D1
    try {
      const row = (await env.DB.prepare("SELECT role FROM users WHERE id=?")
        .bind(user.id)
        .first()) as { role: string } | null;
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

async function requireAdmin(request: Request, locals: any) {
  const env = getEnv(locals);
  const user = await getSessionUser(request, env);
  if (!user) {
    return {
      user: null,
      error: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  if (user.role !== "admin") {
    return {
      user: null,
      error: new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  return { user, env, error: null as any };
}

function validateBody(body: any) {
  const errors: string[] = [];
  if (!body.title || typeof body.title !== "string" || !body.title.trim())
    errors.push("title required");
  if (!body.content || typeof body.content !== "string" || !body.content.trim())
    errors.push("content required");
  if (!body.slug || typeof body.slug !== "string" || !SLUG_RE.test(body.slug))
    errors.push("slug must match ^[a-z0-9-]+$");
  if (body.status && !["published", "draft"].includes(body.status))
    errors.push("status must be published or draft");
  return errors;
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

async function syncPostTags(db: D1Database, postId: string, tags: string[]) {
  // delete old
  await db.prepare("DELETE FROM post_tags WHERE post_id=?").bind(postId).run();
  for (const raw of tags) {
    const name = raw.trim();
    if (!name) continue;
    const slug = slugifyTag(name);
    // find existing tag by slug or name
    let tagRow = await db
      .prepare("SELECT id FROM tags WHERE slug=? OR name=?")
      .bind(slug, name)
      .first<{ id: string }>();
    let tagId = tagRow?.id;
    if (!tagId) {
      tagId = nanoid(10);
      try {
        await db
          .prepare("INSERT INTO tags (id, name, slug) VALUES (?,?,?)")
          .bind(tagId, name, slug)
          .run();
      } catch {
        // if slug conflict try fetch again
        const again = await db
          .prepare("SELECT id FROM tags WHERE slug=?")
          .bind(slug)
          .first<{ id: string }>();
        if (again?.id) tagId = again.id;
        else continue;
      }
    }
    await db
      .prepare("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?,?)")
      .bind(postId, tagId)
      .run();
  }
}

// ── GET (保留) ──
export const GET: APIRoute = async ({ locals, url }) => {
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "20", 10) || 20,
    50,
  );
  const offset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;

  let posts: any[] = [];
  let total = 0;

  try {
    const env = getEnv(locals);
    const db: D1Database | undefined = env.DB;
    if (db) {
      const cnt = await db
        .prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published'")
        .first<{ cnt: number }>();
      total = cnt?.cnt ?? 0;
      const res = await db
        .prepare(
          "SELECT id, slug, title, excerpt, content, status, published_at as publishedAt, created_at as createdAt FROM posts WHERE status='published' ORDER BY published_at DESC, created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(limit, offset)
        .all();
      posts = ((res.results ?? res) as any[]) ?? [];
      total = total || posts.length;
    } else {
      throw new Error("no DB");
    }
  } catch {
    const all = seedData.posts;
    total = all.length;
    posts = all.slice(offset, offset + limit).map((p) => ({
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
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAdmin(request, locals);
  if (auth.error) return auth.error;
  const { user, env } = auth;
  const db: D1Database = env.DB;
  if (!db)
    return new Response(JSON.stringify({ error: "DB not configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
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

  try {
    await db
      .prepare(
        "INSERT INTO posts (id, slug, title, excerpt, content, status, author_id, published_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        body.slug,
        body.title.trim(),
        body.excerpt ?? null,
        body.content,
        body.status ?? "published",
        user.id,
        publishedAt,
        now,
        now,
      )
      .run();

    if (tags.length) await syncPostTags(db, id, tags);

    return new Response(
      JSON.stringify({ id, slug: body.slug, title: body.title }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE") && msg.includes("slug")) {
      return new Response(JSON.stringify({ error: "slug already exists" }), {
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
export const PATCH: APIRoute = async ({ request, locals, url }) => {
  const auth = await requireAdmin(request, locals);
  if (auth.error) return auth.error;
  const { env } = auth;
  const db: D1Database = env.DB;
  if (!db)
    return new Response(JSON.stringify({ error: "DB not configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  // id can come from body.id or query ?id=
  const id = body.id ?? url.searchParams.get("id");
  if (!id)
    return new Response(JSON.stringify({ error: "id required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  // fetch existing to validate
  const existing = await db
    .prepare("SELECT id FROM posts WHERE id=?")
    .bind(id)
    .first();
  if (!existing)
    return new Response(JSON.stringify({ error: "post not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });

  // validate if fields present
  if (body.slug && !SLUG_RE.test(body.slug))
    return new Response(
      JSON.stringify({ error: "slug must match ^[a-z0-9-]+$" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  if (body.title !== undefined && (!body.title || !String(body.title).trim()))
    return new Response(JSON.stringify({ error: "title required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  if (
    body.content !== undefined &&
    (!body.content || !String(body.content).trim())
  )
    return new Response(JSON.stringify({ error: "content required" }), {
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
  if (body.content !== undefined) {
    fields.push("content=?");
    values.push(body.content);
  }
  if (body.status !== undefined) {
    if (!["published", "draft"].includes(body.status))
      return new Response(
        JSON.stringify({ error: "status must be published or draft" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    fields.push("status=?");
    values.push(body.status);
    // if published and no published_at, set now; if draft, keep as is? set published_at accordingly
    if (body.status === "published") {
      const cur = await db
        .prepare("SELECT published_at FROM posts WHERE id=?")
        .bind(id)
        .first<{ published_at: number | null }>();
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
      await db
        .prepare(`UPDATE posts SET ${fields.join(", ")} WHERE id=?`)
        .bind(...values)
        .run();
    }
    if (body.tags !== undefined) {
      const tags = parseTags(body.tags);
      await syncPostTags(db, id, tags);
    }
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE") && msg.includes("slug")) {
      return new Response(JSON.stringify({ error: "slug already exists" }), {
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
export const DELETE: APIRoute = async ({ request, locals, url }) => {
  const auth = await requireAdmin(request, locals);
  if (auth.error) return auth.error;
  const { env } = auth;
  const db: D1Database = env.DB;
  if (!db)
    return new Response(JSON.stringify({ error: "DB not configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

  let id: string | null = url.searchParams.get("id");
  if (!id) {
    try {
      const body: any = await request.json();
      id = body?.id ?? null;
    } catch {}
  }
  if (!id)
    return new Response(JSON.stringify({ error: "id required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  const existing = await db
    .prepare("SELECT id FROM posts WHERE id=?")
    .bind(id)
    .first();
  if (!existing)
    return new Response(JSON.stringify({ error: "post not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });

  // cascade will delete post_tags via FK, but ensure
  await db.prepare("DELETE FROM post_tags WHERE post_id=?").bind(id).run();
  await db.prepare("DELETE FROM posts WHERE id=?").bind(id).run();

  return new Response(JSON.stringify({ ok: true, id }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
