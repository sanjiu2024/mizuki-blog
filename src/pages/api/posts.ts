import type { APIRoute } from "astro";
import { seedData } from "../../db/seed";
import { db } from "../../db/client";
import { auth } from "../../auth";
import { nanoid } from "nanoid";

export const prerender = false;

const SLUG_RE = /^[a-z0-9-]+$/;

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

async function requireAdmin(request: Request) {
  const user = await getSessionUser(request);
  if (!user) {
    return {
      user: null,
      error: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  if (!["admin", "super_admin"].includes(user.role)) {
    return {
      user: null,
      error: new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  return { user, error: null as any };
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
export const GET: APIRoute = async ({ url }) => {
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "20", 10) || 20,
    50,
  );
  const offset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;

  let posts: any[] = [];
  let total = 0;

  try {
    const cnt = await first(
      "SELECT COUNT(*) as cnt FROM posts WHERE status='published'",
      [],
    );
    total = Number(cnt?.cnt ?? 0);
    posts = await all(
      "SELECT id, slug, title, excerpt, content, status, published_at as publishedAt, created_at as createdAt FROM posts WHERE status='published' ORDER BY published_at DESC, created_at DESC LIMIT ? OFFSET ?",
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
  const gate = await requireAdmin(request);
  if (gate.error) return gate.error;
  const { user } = gate;

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
    await run(
      "INSERT INTO posts (id, slug, title, excerpt, content, status, author_id, published_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
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
      ],
    );

    if (tags.length) await syncPostTags(id, tags);

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
export const PATCH: APIRoute = async ({ request, url }) => {
  const gate = await requireAdmin(request);
  if (gate.error) return gate.error;

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
  const existing = await first("SELECT id FROM posts WHERE id=?", [id]);
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
export const DELETE: APIRoute = async ({ request, url }) => {
  const gate = await requireAdmin(request);
  if (gate.error) return gate.error;

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

  const existing = await first("SELECT id FROM posts WHERE id=?", [id]);
  if (!existing)
    return new Response(JSON.stringify({ error: "post not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });

  // cascade will delete post_tags via FK, but ensure
  await run("DELETE FROM post_tags WHERE post_id=?", [id]);
  await run("DELETE FROM posts WHERE id=?", [id]);

  return new Response(JSON.stringify({ ok: true, id }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
