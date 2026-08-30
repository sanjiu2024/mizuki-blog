# Architecture — Mizuki Dynamic Blog

## 视觉层
- **Token 源**：LyraVoid/Mizuki `variables.styl` + `main.css` + `banner.css` + `transition-vars.css`，全部基于 `oklch(… var(--hue))`，默认 `hue=240`
- **Tailwind v4**：`@theme` + `@custom-variant dark`，断点 `768/1280/1920`，圆角 `--radius-large 1rem`
- **组件**：`Banner.astro` 65vh + 4层波浪 (7/10/13/20s) + 轮播 3s，`Card.astro` 圆角卡片，`BaseLayout.astro` + `ConfigCarrier` 驱动 `--hue`，`ThemeToggle` 暗色+ hue 调色盘

## 数据层
- **D1 6表**：`users`（兼容 better-auth `user`）、`posts`（slug unique + FTS5）、`tags`、`post_tags`（多对多）、`comments`（parentId 楼中楼）、`comment_reactions`（唯一点赞）
- **索引**：`idx_posts_slug`、`idx_posts_published`、`idx_comment_post_created`、`idx_post_tags`
- **FTS5**：`posts_fts` 虚拟表 `porter unicode61` + 3 触发器（insert/delete/update），查询用 `bm25/snippet` raw SQL（见 `src/db/search.ts`）
- **Drizzle**：`drizzle-orm/d1` + `drizzle-kit`，`drizzle.config.ts` 指向 `wrangler.jsonc` 的 `mizuki-db`

## 鉴权层
- **better-auth 1.7.1**：`drizzleAdapter(createDb(env.DB), {provider: "sqlite"})`，`emailAndPassword` 最小 8 位，`emailVerified` 可选
- **会话**：KV `SESSION`（`Astro.session` 自动绑定），`BETTER_AUTH_SECRET` 存 `.dev.vars` / GitHub Secrets
- **路由**：`src/pages/api/auth/[...auth].ts` 代理所有 `/api/auth/*`，`login.astro`/`register.astro` 前端直调 `fetch('/api/auth/sign-up/email')`

## 运行时
- **Astro 7**：`output: server` + `@astrojs/cloudflare` 14.2.5，`vite` 集成 `@tailwindcss/vite`
- **Wrangler**：`wrangler.jsonc`（`main` 指向 `@astrojs/cloudflare/entrypoints/server`，`compatibility_flags: ["nodejs_compat"]`，`assets`/`d1_databases`/`kv_namespaces`）
- **体积**：`2404 KiB / gzip 530 KiB`（`wrangler deploy --dry-run`），远低于 3MB 限制

## 搜索/RSS
- **搜索**：`src/db/search.ts` raw FTS5，`src/pages/search.astro` + `src/pages/api/search.ts`，空结果降级 `LIKE`
- **RSS**：`src/pages/rss.xml.ts` 用 `@astrojs/rss`，`prerender=false` 直接查 D1

## 页面
- `index.astro` 分页 `limit/offset` + D1/mock 双源 + 空状态
- `posts/[...slug].astro` Markdown 渲染 + 评论区（`#comments-root` 直连 `POST /api/comments`）
- `tags/[tag].astro` + `tags/index.astro` + `archive.astro`（`strftime('%Y-%m') GROUP BY`）
- 二次元：`friends.astro` / `bangumi.astro`

## 波次
`T01 init → T02 token + T04 D1 → T03 layout + T05 auth + T07 search → T06 comments → T09 deploy → T10 CI`
