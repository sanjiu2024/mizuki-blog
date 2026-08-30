# Mizuki Blog — 动态版 · Cloudflare Workers

> 只抽 [LyraVoid/Mizuki](https://github.com/LyraVoid/Mizuki)（演示站 https://mizuki.mysqil.com/ ）的视觉 Token，移植到全新动态栈 `Astro 7 + Cloudflare Workers + D1 + KV + better-auth`。支持登录、评论、标签/归档、FTS5 搜索、RSS、暗色/壁纸/动效与二次元特色页。

## ✨ 特性

- **视觉**：hue=240 `oklch`、圆角 `1rem`、M3 卡片+阴影、Banner 65vh + 4层视差波浪 (7/10/13/20s)、Swup 风格过渡 120ms、断点 `768/1280/1920`
- **内容**：D1 6表（users/posts/tags/post_tags/comments/comment_reactions）+ FTS5 `porter unicode61` 全文搜索 + 触发器同步
- **动态**：`output: server` + `@astrojs/cloudflare`，`better-auth 1.7.1` 原生 `drizzleAdapter`，KV `SESSION` 会话
- **交互**：登录/注册、评论楼中楼（401/201）、标签页、归档 `strftime('%Y-%m') GROUP BY`、搜索 `bm25/snippet`、RSS
- **二次元**：友链、追番占位、ThemeToggle（暗色+ hue 调色盘）、Banner 轮播
- **部署**：`wrangler.jsonc` 一键上 Workers，静态资源走 `ASSETS` 免费无限，D1 按扫描行计费

## 🚀 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # -> dist/ + dist/_worker.js
pnpm preview
```

## 🗄️ 数据库

```bash
# 本地 D1（需 wrangler 4.127+）
pnpm db:migrate:local   # wrangler d1 migrations apply DB --local
# 远端
pnpm db:migrate:remote  # --remote 需先 wrangler login

# 查看表
wrangler d1 execute mizuki-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"
# 搜索验证
wrangler d1 execute mizuki-db --local --command "SELECT * FROM posts_fts WHERE posts_fts MATCH 'mizuki' ORDER BY rank"
```

Schema 见 `src/db/schema.ts`，迁移 `migrations/0001_init.sql`（含 FTS5 虚拟表 + 触发器 + seed）。

## 🔐 鉴权

- `src/auth.ts` 使用 `better-auth` + `drizzleAdapter`，环境变量 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` （本地在 `.dev.vars`）
- 路由 `src/pages/api/auth/[...auth].ts` 代理所有 `/api/auth/*`
- 前台 `src/pages/login.astro` / `register.astro` 直接 `fetch('/api/auth/sign-up/email')`
- **GitHub OAuth** (`T14`)：`src/auth.ts` 中 `socialProviders.github` 已配置 `mapProfileToUser` 将 `avatar_url → user.image`，Header 头像由 `BaseLayout.astro` 的 `fetch('/api/auth/get-session')` 驱动显示，登录后展示头像/名称/退出按钮

### GitHub OAuth App 创建步骤

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Application name: `mizuki-blog`，Homepage URL: `https://<your-workers>.workers.dev`
3. **Authorization callback URL** 需同时登记两个（Production + Local）：
   - `https://<your-workers>.workers.dev/api/auth/callback/github`
   - `http://localhost:4321/api/auth/callback/github`（本地开发）
   > better-auth 要求回调路径为 `/api/auth/callback/<provider>`，不可改为其他路径。
4. 生成 Client ID / Client Secret，写入环境变量见下表。

### 环境变量矩阵

| 变量                   | 说明                                      | 本地 `.dev.vars`        | 远端 `wrangler secret` / Dashboard Vars       |
| ---------------------- | ----------------------------------------- | ----------------------- | --------------------------------------------- |
| `BETTER_AUTH_SECRET`   | 32+ 字符随机串，`openssl rand -base64 32` | ✅                      | ✅ (`wrangler secret put BETTER_AUTH_SECRET`) |
| `BETTER_AUTH_URL`      | 站点基地址，用于回调拼接                  | `http://localhost:4321` | `https://<workers>.workers.dev`               |
| `GITHUB_CLIENT_ID`     | GitHub OAuth App ID                       | ✅                      | ✅                                            |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Secret                   | ✅                      | ✅ (`secret put`)                             |

示例 `.dev.vars`：

```
BETTER_AUTH_SECRET=dev-secret-please-change-32-chars-min
BETTER_AUTH_URL=http://localhost:4321
GITHUB_CLIENT_ID=Ov23li...
GITHUB_CLIENT_SECRET=xxx
```

## 🔍 搜索

- 封装 `src/db/search.ts` 的 `searchPosts(db, q)` 用 `prepare + MATCH + bm25/snippet` raw SQL，`escapeFts5Query()` 转义引号/星号/操作符，失败自动降级 `LIKE "%q%" ESCAPE '\'`（`%/_` 已转义）
- 页面 `src/pages/search.astro` 与 API `src/pages/api/search.ts` 复用同一封装，`snippet` 仅放行 `<mark>`（其余 `escapeHtml`），输入截断 100 字符
- 无 DB 时降级 `LIKE` 模糊

## 🎨 视觉 Token

移植清单（`src/styles/`）：

- `tokens.css` — `@theme` + `@custom-variant dark` + `oklch` 变量（`--primary`/`--page-bg`/`--card-bg` 等）
- `banner.css` — 65vh + 轮播 3s + 波浪 4 层
- `transition.css` — `--transition-duration 120ms`
- `layout.css` — `PAGE_WIDTH 90rem` + 响应式轨道
- `src/lib/config.ts` + `src/components/ConfigCarrier.astro` — `localStorage.hue -> --hue`

## 💬 评论与点赞

- **评论树**：`POST /api/comments` 支持 `parentId`，`GET /api/comments?postId=` 返回 `COUNT(comment_reactions)` 的 `likeCount` 并在服务端构建 `tree`（`parent_id → children` 递归，时间正序），前端 `posts/[...slug].astro` 按树递归渲染楼中楼（`margin-left` + 边框缩进 + Reply 按钮设置 `parentId`）
- **点赞**：`POST /api/comments/:id/like`（兼容 `POST /api/comments/like {commentId}`）对 `comment_reactions` 做唯一约束插入，重复点赞则切换为取消（toggle），返回 `{ liked, likeCount }`，前端按钮实时更新计数
- **限流**：内存 `Map<ip, timestamps>`，评论 `5次/分钟`、点赞 `10次/分钟`，超出 `429`

## ☁️ 部署到 Cloudflare Workers

前置：`wrangler login`，在 Dashboard 创建 D1 `mizuki-db` 与 KV `SESSION`（或让 `wrangler deploy` 自动创建）。

```bash
# wrangler.jsonc 已配好
{
  "name": "mizuki-blog",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-08-30",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "binding": "ASSETS", "directory": "./dist" },
  "d1_databases": [{ "binding": "DB", "database_name": "mizuki-db", "migrations_dir": "migrations" }],
  "kv_namespaces": [{ "binding": "SESSION", "id": "local-session" }]
}

pnpm build
wrangler deploy                  # 或 pnpm deploy
wrangler deploy --dry-run        # 检查 <3MB gzip
```

自定义域：Dashboard `Workers & Pages → mizuki-blog → Settings → Domains & Routes → Add Custom Domain`。

CI 见 `.github/workflows/ci.yml`，需在 GitHub Secrets 配置 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `BETTER_AUTH_SECRET` / `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`。

## 🧪 测试

```bash
pnpm exec vitest run   # tests/search.test.ts 覆盖 escapeFts5Query + searchPosts 转义/降级
```

## 📚 目录

```
src/
  auth.ts                 # better-auth 工厂
  middleware.ts           # 轻量中间件
  db/
    schema.ts             # 6表 + relations
    client.ts             # drizzle(env.DB)
    search.ts             # FTS5 raw SQL
    seed.ts               # 示例数据
  styles/
    tokens.css banner.css transition.css layout.css
  layouts/BaseLayout.astro
  components/Banner.astro Card.astro ConfigCarrier.astro ThemeToggle.astro
  pages/
    index.astro           # 首页分页 + D1/mock 双源
    posts/[...slug].astro # 详情 + 评论区
    tags/[tag].astro tags/index.astro
    archive.astro search.astro friends.astro bangumi.astro
    login.astro register.astro
    rss.xml.ts
    api/
      auth/[...auth].ts posts.ts comments.ts search.ts
```

## 📝 写作

目前内容走 D1（动态），也可在 `src/db/seed.ts` 或直接 `wrangler d1 execute --command "INSERT INTO posts..."` 新增。后续可加后台 `/admin` 或接入 MD 文件同步脚本。

## 🙏 致谢

- 视觉灵感与 Token 源：[LyraVoid/Mizuki](https://github.com/LyraVoid/Mizuki) / [Shirone](https://github.com/lyraVoid/shirone)，祖先链 `Fuwari → Yukina → Firefly → Mizuki`
- 部署：`Astro` + `Cloudflare Workers` + `Drizzle` + `better-auth`
