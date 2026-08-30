# Architecture — Mizuki Dynamic Blog

## 视觉层

- **Token 源**：LyraVoid/Mizuki `variables.styl` + `main.css` + `banner.css` + `transition-vars.css`，全部基于 `oklch(… var(--hue))`，默认 `hue=240`
- **Tailwind v4**：`@theme` + `@custom-variant dark`，断点 `768/1280/1920`，圆角 `--radius-large 1rem`
- **组件**：`Banner.astro` 65vh + 4层波浪 (7/10/13/20s) + 轮播 3s，`Card.astro` 圆角卡片，`BaseLayout.astro` + `ConfigCarrier` 驱动 `--hue`，`ThemeToggle` 暗色+ hue 调色盘

## 数据层

- **D1 6表**：`users`（兼容 better-auth `user`）、`posts`（slug unique + FTS5）、`tags`、`post_tags`（多对多）、`comments`（parentId 楼中楼）、`comment_reactions`（唯一点赞）
- **索引**：`idx_posts_slug`、`idx_posts_published`、`idx_comment_post_created`、`idx_post_tags`、`idx_reaction_unique(comment_id, user_id)`
- **FTS5**：`posts_fts` 虚拟表 `porter unicode61` + 3 触发器（insert/delete/update），查询用 `bm25/snippet` raw SQL（见 `src/db/search.ts`），`escapeFts5Query()` 转义引号/星号/操作符，异常降级 `LIKE "%q%" ESCAPE '\'`
- **Drizzle**：`drizzle-orm/d1` + `drizzle-kit`，`drizzle.config.ts` 指向 `wrangler.jsonc` 的 `mizuki-db`

## 鉴权层

- **better-auth 1.7.1**：`drizzleAdapter(createDb(env.DB), {provider: "sqlite"})`，`emailAndPassword` 最小 8 位，`emailVerified` 可选，`socialProviders.github` 配置 `scope: ["user:email","read:user"]` + `mapProfileToUser: avatar_url → user.image`
- **会话**：KV `SESSION`（`Astro.session` 自动绑定），`BETTER_AUTH_SECRET` 存 `.dev.vars` / GitHub Secrets，`BETTER_AUTH_URL` 区分本地/远端
- **路由**：`src/pages/api/auth/[...auth].ts` 代理所有 `/api/auth/*`，`login.astro`/`register.astro` 前端直调 `fetch('/api/auth/sign-up/email')`，GitHub 登录走 `/api/auth/sign-in/social`
- **Header**：`BaseLayout.astro` 通过 `fetch('/api/auth/get-session')` 异步刷新头像/名称/退出，`user.image` 来自 GitHub `avatar_url` 映射

## 运行时

- **Astro 7**：`output: server` + `@astrojs/cloudflare` 14.2.5，`vite` 集成 `@tailwindcss/vite`
- **Wrangler**：`wrangler.jsonc`（`main` 指向 `@astrojs/cloudflare/entrypoints/server`，`compatibility_flags: ["nodejs_compat"]`，`assets`/`d1_databases`/`kv_namespaces`）
- **体积**：`~2400 KiB / gzip ~530 KiB`（`wrangler deploy --dry-run`），远低于 3MB 限制

## 搜索/RSS

- **搜索**：`src/db/search.ts` raw FTS5 + `escapeFts5Query` + LIKE 降级，`src/pages/search.astro` 对 `snippet` 仅放行 `<mark>`（`sanitizeSnippet`），`src/pages/api/search.ts` 复用同一封装
- **RSS**：`src/pages/rss.xml.ts` 用 `@astrojs/rss`，`prerender=false` 直接查 D1

## 页面

- `index.astro` 分页 `limit/offset` + D1/mock 双源 + 空状态
- `posts/[...slug].astro` Markdown 渲染 + 评论区树渲染（`GET tree` → 递归 `margin-left` + 回复/点赞按钮）
- `tags/[tag].astro` 分页 `?page=&limit` + `LIMIT/OFFSET` + `COUNT` 总数，`tags/index.astro` + `archive.astro`（`strftime('%Y-%m') GROUP BY`）
- 二次元：`friends.astro` / `bangumi.astro`

## 评论/点赞

- **表**：`comments(parent_id)` 自引用 + `comment_reactions(comment_id, user_id UNIQUE, type='like')`
- **API**：
  - `GET /api/comments?postId=`：`LEFT JOIN comment_reactions COUNT GROUP BY` 取 `likeCount`，服务端 `buildTree()` 按 `parent_id` 组树，返回 `{ comments, tree }`
  - `POST /api/comments`：需登录 + 限流 `5/min/IP`（内存 Map），`429` 超限，支持 `parentId` 楼中楼
  - `POST /api/comments/:id/like` 及 `POST /api/comments/like {commentId}`：需登录，唯一约束插入，冲突则 `DELETE` 切换为取消，返回 `{ liked, likeCount }`
- **前端**：`posts/[...slug].astro` 内联脚本 `buildTree → renderNode` 递归缩进，回绑定 `data-reply`/`data-like` 事件，回复设置 `replyParentId`，点赞 `fetch` 后更新计数

## 管理

- `src/pages/admin` 需 `role=admin` 中间件鉴权（T13），D1 直连增删改查

## 波次

`T01 init → T02 token + T04 D1 → T03 layout + T05 auth + T07 search → T06 comments → T09 deploy → T10 CI → T11 GitHub OAuth + avatar → T14 polish (tree/like/rate-limit/FTS escape)`
