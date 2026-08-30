export async function seed(d1: any) {
  const now = Date.now();
  await d1.batch([
    d1
      .prepare(
        "INSERT OR IGNORE INTO users (id, email, name, email_verified, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind("user_admin_01", "admin@mizuki.blog", "Mizuki", 1, null, now, now),
  ]);
  await d1.batch([
    d1
      .prepare("INSERT OR IGNORE INTO tags (id, name, slug) VALUES (?, ?, ?)")
      .bind("tag_astro_01", "astro", "astro"),
    d1
      .prepare("INSERT OR IGNORE INTO tags (id, name, slug) VALUES (?, ?, ?)")
      .bind("tag_mizuki_02", "mizuki", "mizuki"),
  ]);
  await d1.batch([
    d1
      .prepare(
        "INSERT OR IGNORE INTO posts (id, slug, title, excerpt, content, status, author_id, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "post_hello_01",
        "hello-mizuki",
        "Hello Mizuki",
        "Welcome to Mizuki Blog — a fresh start on Cloudflare Workers.",
        "# Hello Mizuki\n\nThis is the first post of the Mizuki dynamic blog powered by Astro 7 and Cloudflare Workers.",
        "published",
        "user_admin_01",
        now,
        now,
        now,
      ),
    d1
      .prepare(
        "INSERT OR IGNORE INTO posts (id, slug, title, excerpt, content, status, author_id, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "post_deepsea_02",
        "deep-sea-notes",
        "Deep Sea Notes",
        "Fragments from the abyss — where light fades, ideas glow.",
        "# Deep Sea Notes\n\nThe deep sea is not silent; it whispers in bioluminescence.",
        "published",
        "user_admin_01",
        now,
        now,
        now,
      ),
    d1
      .prepare(
        "INSERT OR IGNORE INTO posts (id, slug, title, excerpt, content, status, author_id, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "post_astro_03",
        "astro-on-workers",
        "Astro on Workers",
        "Running Astro SSR on Cloudflare Workers with D1 and KV.",
        "# Astro on Workers\n\nAstro output server mode plus @astrojs/cloudflare adapter makes edge SSR simple.",
        "published",
        "user_admin_01",
        now,
        now,
        now,
      ),
  ]);
  await d1.batch([
    d1
      .prepare(
        "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
      )
      .bind("post_hello_01", "tag_mizuki_02"),
    d1
      .prepare(
        "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
      )
      .bind("post_hello_01", "tag_astro_01"),
    d1
      .prepare(
        "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
      )
      .bind("post_astro_03", "tag_astro_01"),
    d1
      .prepare(
        "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
      )
      .bind("post_deepsea_02", "tag_mizuki_02"),
  ]);
  await d1.batch([
    d1
      .prepare(
        "INSERT OR IGNORE INTO comments (id, post_id, author_id, parent_id, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "cmt_01",
        "post_hello_01",
        "user_admin_01",
        null,
        "Welcome aboard! Looking forward to more deep-sea notes.",
        "approved",
        now,
      ),
    d1
      .prepare(
        "INSERT OR IGNORE INTO comments (id, post_id, author_id, parent_id, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "cmt_02",
        "post_hello_01",
        null,
        "cmt_01",
        "Thanks — this theme is gorgeous!",
        "approved",
        now + 1,
      ),
  ]);
  return { ok: true };
}

export const seedData = {
  users: [
    {
      id: "user_admin_01",
      email: "admin@mizuki.blog",
      name: "Mizuki",
      createdAt: Date.now(),
    },
  ],
  posts: [
    {
      id: "post_hello_01",
      slug: "hello-mizuki",
      title: "Hello Mizuki",
      excerpt: "Welcome to Mizuki Blog",
      content: "# Hello Mizuki",
      status: "published",
      authorId: "user_admin_01",
      publishedAt: Date.now(),
      createdAt: Date.now(),
    },
    {
      id: "post_deepsea_02",
      slug: "deep-sea-notes",
      title: "Deep Sea Notes",
      excerpt: "Fragments",
      content: "# Deep Sea Notes",
      status: "published",
      authorId: "user_admin_01",
      publishedAt: Date.now(),
      createdAt: Date.now(),
    },
    {
      id: "post_astro_03",
      slug: "astro-on-workers",
      title: "Astro on Workers",
      excerpt: "Running Astro SSR",
      content: "# Astro on Workers",
      status: "published",
      authorId: "user_admin_01",
      publishedAt: Date.now(),
      createdAt: Date.now(),
    },
  ],
  tags: [
    { id: "tag_astro_01", name: "astro", slug: "astro" },
    { id: "tag_mizuki_02", name: "mizuki", slug: "mizuki" },
  ],
  postTags: [
    { postId: "post_hello_01", tagId: "tag_mizuki_02" },
    { postId: "post_astro_03", tagId: "tag_astro_01" },
  ],
  comments: [
    {
      id: "cmt_01",
      postId: "post_hello_01",
      authorId: "user_admin_01",
      parentId: null,
      content: "Welcome aboard!",
      status: "approved",
      createdAt: Date.now(),
    },
    {
      id: "cmt_02",
      postId: "post_hello_01",
      authorId: null,
      parentId: "cmt_01",
      content: "Thanks — this theme is gorgeous!",
      status: "approved",
      createdAt: Date.now(),
    },
  ],
};
