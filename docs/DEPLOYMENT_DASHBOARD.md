# Dashboard 部署手册 — Mizuki Blog → Cloudflare Workers

> 不用 `wrangler` 命令行，全部在 https://dash.cloudflare.com 上点鼠标完成。对应仓库 https://github.com/sanjiu2024/mizuki-blog（分支 `main`，构建产物 `dist/`，运行时 `Astro 7 + Workers + D1 + KV + better-auth`）。

---

## 0. 准备

- Cloudflare 账号（免费即可）+ 已验证邮箱
- GitHub 仓库已推送（本仓库 `main` 分支）
- GitHub OAuth App 待创建（见 §3，若先不做 GitHub 登录可跳过，邮箱密码仍可用）

---

## 1. 创建 Workers 并绑定 GitHub（Dashboard 建项目）

1. 打开 https://dash.cloudflare.com → 左侧 **Workers & Pages** → 右上 **Create** → 选 **Workers** 页签（不是 Pages，2026 起新项目官方推荐 Workers）
2. 点 **Import a repository** → 授权 GitHub → 选中 `sanjiu2024/mizuki-blog` → **Begin setup**
3. **Configure your Worker**：
   - **Project name**：`mizuki-blog`（与 `wrangler.jsonc` 的 `name` 一致，决定 `https://mizuki-blog.<子域>.workers.dev`）
   - **Branch**：`main`
   - **Build configuration**：
     - **Framework preset**：`Astro`
     - **Build command**：`pnpm install --frozen-lockfile && pnpm build`（若 Dashboard 已自动填 `npm run build`，改成这条；`pnpm` 比 `npm` 省 30% 时间）
     - **Deploy command**：**必须填** `npx wrangler deploy`（或 `pnpm deploy`，对应 `package.json` 的 `astro build && wrangler deploy`；留空会导致 Dashboard 跳过部署，只构建不发布）
     - **Root directory**：留空（项目在根）
     - **Environment variables (Build)**：先不填，§2 再加
   - **Failed to find wrangler.jsonc** 不用管，本仓库已提供 `wrangler.jsonc`（`assets + d1_databases + kv_namespaces`），Dashboard 会自动读取
4. 点 **Save and Deploy** → 等待 **Build → Deploy** 绿灯（约 2-3 分钟，日志可见 `astro build` 37s + `Total Upload 544 KiB gzip`）
   - 若 Build 失败，点 **View build logs** 看 `pnpm astro check` / `pnpm build` 报错（常见为 `pnpm-lock.yaml` 未提交）
5. 首次部署成功后，Dashboard 会给出 **Preview URL**：`https://mizuki-blog.<你的子域>.workers.dev`，点开应能看到 Banner `わたしの部屋` + 空状态 `まだ記事がありません`（D1 还未建）

> **Pages 方式（备选，不推荐）**：若你选 `Workers & Pages → Create → Pages → Connect to Git`，Build 填 `pnpm build`、Output `dist`，后续 D1/KV 需改用 `Pages Functions` 绑定，步骤不同。本文按 Workers 写。

---

## 2. 创建并绑定 D1 + KV（不绑则首页 500 或登录 500）

### 2.1 建 D1 数据库

1. 左侧 **Workers & Pages → D1 SQL Database** → **Create database** → **Database name** 填 `mizuki-db` → **Create**
2. 记下 **Database ID**（形如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`），回到 **Workers & Pages → mizuki-blog → Settings → Variables and Secrets**
   - 往下滚到 **D1 database bindings** → **Add binding** → **Variable name** 填 `DB`（必须叫 `DB`，与 `wrangler.jsonc` 和 `src/db/client.ts` 一致）→ **D1 database** 选 `mizuki-db` → **Add binding**
3. 回到 D1 详情页 → **Console** 标签 → 粘贴 `migrations/0001_init.sql` 全文 → **Execute** → 再粘贴 `migrations/0002_auth.sql` → **Execute** → 再粘贴 `migrations/0003_admin.sql` → **Execute**
   - 成功后左侧 **Tables** 应看到 `users/posts/tags/post_tags/comments/comment_reactions/session/account/verification` + `posts_fts`
   - 验证：Console 执行 `SELECT name FROM sqlite_master WHERE type='table';` 应返回 9 行
   - 也可验证 `SELECT * FROM posts LIMIT 1;`（seed 已写入 3 篇）

> **为什么 Dashboard 手动执行迁移**：`wrangler d1 migrations apply` 也可，但 Dashboard 方式无需本地 `wrangler login`，对纯 Dashboard 用户更友好。后续增量迁移同理粘贴新 `migrations/*.sql`。

### 2.2 建 KV 命名空间（SESSION）

1. 左侧 **Workers & Pages → KV** → **Create a namespace** → **Namespace name** 填 `mizuki-session` → **Create**
2. 回到 **Workers → mizuki-blog → Settings → Variables → KV namespace bindings** → **Add binding** → **Variable name** 填 `SESSION` → **KV namespace** 选 `mizuki-session` → **Add binding**
3. **注意**：`wrangler.jsonc` 中 `kv_namespaces: [{binding:"SESSION", id:"local-session"}]` 的 `id` 为本地占位，Dashboard 绑定后会自动覆盖，不用改文件

### 2.3 （可选）建 R2 / Images

本项目暂未用 R2 上传头像，`wrangler.jsonc` 已声明 `Images` 绑定由 `@astrojs/cloudflare` 自动注入，无需手动建。

---

## 3. 环境变量与 Secrets（Dashboard 加 4 项）

> GitHub 登录必做；若先不做 GitHub 登录，只做邮箱密码，则只需 `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL`

### 3.1 先在 GitHub 创建 OAuth App

1. 打开 https://github.com/settings/developers → **OAuth Apps → New OAuth App**
2. **Application name**：`Mizuki Blog`
3. **Homepage URL**：`https://mizuki-blog.<子域>.workers.dev`（或你后续要绑的自定义域 `https://blog.example.com`）
4. **Authorization callback URL**：**必须** 填
   - 生产：`https://mizuki-blog.<子域>.workers.dev/api/auth/callback/github`
   - 本地：`http://localhost:4321/api/auth/callback/github`（若本地也要测，建议另建一个 OAuth App 专门给 localhost）
   > `baseURL` 与 `trustedOrigins` 已在 `src/auth.ts` 读 `BETTER_AUTH_URL`，回调路径固定 `/api/auth/callback/github`（`basePath` 默认为 `/api/auth`）
5. **Create** → 复制 **Client ID** → 点 **Generate a new client secret** → 复制 **Client Secret**（只显示一次）

### 3.2 回到 Cloudflare Dashboard 加变量

**Workers → mizuki-blog → Settings → Variables and Secrets** → 分两区添加：

**Variables（明文，Add variable）**：
- `BETTER_AUTH_URL` = `https://mizuki-blog.<子域>.workers.dev`（若绑了自定义域，改成 `https://blog.example.com`，与上一步 Homepage 一致）
- `GITHUB_CLIENT_ID` = `Ov23li...`（上一步复制）

**Secrets（加密，Add secret → Encrypt）**：
- `BETTER_AUTH_SECRET` = `openssl rand -base64 32` 的输出（32 字符以上随机，本地 `.dev.vars.example` 有占位 `dev-secret-please-change-32-chars-min`，生产必须换强随机）
- `GITHUB_CLIENT_SECRET` = `ghu_...`（上一步生成）

> **Build 环境也要**：同页往上找到 **Build → Variables and Secrets**（或 **Settings → Build → Variables**），把上面 4 项再加一遍，确保 `pnpm build` 时 `better-auth` 能读到 `BETTER_AUTH_URL`（Workers 运行时与 Build 时环境隔离）

4. 加完点 **Save and deploy**（或 **Retry deployment**）触发重新部署，日志应无 `GITHUB_CLIENT_ID missing` 报错

---

## 4. 重新部署与验证

1. **Deployments** 标签 → 最新一次 **View details** → **Build log** 确认 `pnpm astro check` 0 errors、`pnpm build` Complete、`Total Upload 544 KiB gzip`
2. 打开 **Visit** 链接：
   - `/` 应显示 Banner + 3 篇 seed 文章（`Hello Mizuki 🌊 / 深海笔记 / Astro on Workers`）
   - `/login` 应有 **GitHub 登录** 按钮（黑色，带 GitHub 图标），点击应 302 到 `github.com/login/oauth/authorize`
   - 授权后回调回 `/`，右上角 header 应显示头像/名称 + **退出** 按钮
   - 未登录点 `Post comment` 应 401 提示“请登录”；登录后可发评论，评论区实时出现楼中楼
   - `/sitemap.xml` 应含 `<loc>https://.../posts/hello-mizuki/</loc>`，`/robots.txt` 含 `Sitemap: .../sitemap.xml`，`/404` 访问不存在路径应显示 404 卡片
3. **D1 验证**：**D1 → mizuki-db → Console** 执行
   ```sql
   SELECT email, role FROM users LIMIT 5;
   -- 将你的 GitHub 邮箱提权为 admin
   UPDATE users SET role='admin' WHERE email='你的GitHub邮箱';
   SELECT slug, title FROM posts;
   SELECT post_id, content FROM comments ORDER BY created_at DESC LIMIT 5;
   ```
   之后 `/admin` 即可进入后台 **发文/编辑/删除**（未登录 302 到 `/login`，非 admin 403）

---

## 5. 绑定自定义域（可选）

1. **Workers → mizuki-blog → Settings → Domains & Routes → Add → Custom Domain** → 输入 `blog.example.com` → **Add domain**
   - 若域名已在 Cloudflare 托管，自动创建 DNS `CNAME` 并颁发 **Advanced Certificate**（约 1 分钟）
   - 若域名在外部，需按提示到 DNS 服务商加 `CNAME mizuki-blog.<子域>.workers.dev`
2. 回到 **Settings → Variables** 把 `BETTER_AUTH_URL` 改成 `https://blog.example.com` → **Save and deploy**
3. 回到 GitHub OAuth App → **Authorization callback URL** 改成 `https://blog.example.com/api/auth/callback/github` → **Update application**

---

## 6. 日志与回滚

- **Logs**：**Workers → mizuki-blog → Logs** → 选 **Begin log stream** 实时看 `console.log` / `auth` / `D1` 错误；`Observability: enabled` 已在 `wrangler.jsonc` 打开
- **回滚**：**Deployments** → 选历史绿灯版本 → **Rollback to this deployment**
- **删除**：**Settings → Delete**（会同时解绑 D1/KV，但 D1 数据保留在 **D1 → mizuki-db**，可单独删库）

---

## 7. 常见故障（Dashboard 视角）

| 现象 | 原因 | Dashboard 解法 |
|---|---|---|
| `/` 500 `DB not configured` | 未绑定 D1 `DB` | §2.1 重新 **Add D1 binding** `DB` |
| `/login` 点 GitHub 404 | `GITHUB_CLIENT_ID` 未在 **Build** 环境设 | §3.2 在 **Build → Variables** 也加一遍 |
| 回调 `redirect_uri_mismatch` | GitHub App 回调与 `BETTER_AUTH_URL` 不一致 | GitHub App 回调改成 `https://.../api/auth/callback/github`，与 `BETTER_AUTH_URL` 同域 |
| `/admin` 403 | `users.role` 仍为 `user` | D1 Console `UPDATE users SET role='admin' WHERE email='...'` |
| `BETTER_AUTH_SECRET` 报错 | 仍为 `dev-secret...` | 重新 `openssl rand -base64 32` 生成并 **Encrypt** |
| Build `Total Upload` 超 3MB | 引入大依赖 | 本项目已 544 KiB，检查是否本地改动引入 `sharp` 等 |
| `wrangler d1 --local` tcmalloc OOM | 本地沙盒内存限制 | Dashboard 的 **D1 Console** 不受影响，用 Dashboard 执行 SQL |

---

## 8. 与 `wrangler.jsonc` 的对应关系（Dashboard 自动读取）

```jsonc
{
  "name": "mizuki-blog",
  "compatibility_date": "2026-08-30",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@astrojs/cloudflare/entrypoints/server",
  "assets": { "binding": "ASSETS", "directory": "./dist" },
  "d1_databases": [{ "binding": "DB", "database_name": "mizuki-db", "migrations_dir": "migrations" }],
  "kv_namespaces": [{ "binding": "SESSION", "id": "local-session" }],
  "vars": { "BETTER_AUTH_URL": "http://localhost:4321" }, // Dashboard 的 Variables 会覆盖
  "observability": { "enabled": true }
}
```

Dashboard 上的 **D1/KV bindings** 与 **Variables/Secrets** 会在部署时覆盖此文件，无需改仓库即可换生产域。

---

---

## 9. 部署命令（必读 · Dashboard 方式的命令行校验/备用）

> 虽为 Dashboard 部署，以下命令用于**本地校验、手动应急部署、迁移校验**，均已在仓库 `package.json` 配好 `scripts`，直接复制即用。

### 9.1 本地开发

```bash
pnpm install --frozen-lockfile   # 严格按 pnpm-lock.yaml 安装
pnpm dev                          # http://localhost:4321（Astro dev，.dev.vars 自动加载）
pnpm astro check                  # 类型检查（0 errors 方可部署）
pnpm build                        # 生成 dist/ + dist/_worker.js（约 13s，544 KiB gzip）
pnpm preview                      # 预览构建产物（需先 build）
```

### 9.2 数据库迁移（D1）

```bash
# 本地（需 workerd，沙盒可能报 tcmalloc OOM 属环境限制，远端不受影响）
pnpm db:migrate:local             # wrangler d1 migrations apply DB --local
# 远端（需先 wrangler login）
pnpm db:migrate:remote            # wrangler d1 migrations apply DB --remote

# 手动校验（Dashboard D1 Console 也可执行）
wrangler d1 execute mizuki-db --local --command "SELECT name FROM sqlite_master WHERE type='table';"
wrangler d1 execute mizuki-db --remote --command "SELECT slug, title FROM posts LIMIT 5;"
# 提权首个 admin（将 GitHub 邮箱换成你的）
wrangler d1 execute mizuki-db --remote --command "UPDATE users SET role='admin' WHERE email='你的GitHub邮箱';"
```

### 9.3 部署到 Cloudflare（命令行备用，与 Dashboard 等价）

```bash
# 1. 登录（只需一次）
npx wrangler login
# 或用 API Token
# export CLOUDFLARE_API_TOKEN=xxxxx
# export CLOUDFLARE_ACCOUNT_ID=xxxxx

# 2. 预检（不上传）
npx wrangler deploy --dry-run
# 预期：Total Upload: 2476 KiB / gzip: 544.96 KiB（<3MB 安全）

# 3. 正式部署（读取 wrangler.jsonc + dist/）
pnpm deploy                       # = pnpm build && wrangler deploy
# 或分步
pnpm build && npx wrangler deploy

# 4. 部署后校验
curl -I https://mizuki-blog.<子域>.workers.dev/                 # 200
curl https://mizuki-blog.<子域>.workers.dev/sitemap.xml | head
curl https://mizuki-blog.<子域>.workers.dev/robots.txt
curl "https://mizuki-blog.<子域>.workers.dev/api/search?q=mizuki"
```

### 9.4 环境变量（命令行 Secrets）

```bash
# 生成强随机 SECRET
openssl rand -base64 32

# 写入 Secrets（加密存储，不在 wrangler.jsonc 明文）
npx wrangler secret put BETTER_AUTH_SECRET      # 粘贴上步输出
npx wrangler secret put GITHUB_CLIENT_SECRET
# 明文变量（也可在 Dashboard Settings → Variables 加）
npx wrangler secret put GITHUB_CLIENT_ID       # 或用 vars
# BETTER_AUTH_URL 会在 Dashboard Variables 设为 https://mizuki-blog.<子域>.workers.dev
```

### 9.5 CI 自动部署（已配好 .github/workflows/ci.yml）

```yaml
# 推送到 main 自动触发
pnpm install --frozen-lockfile
pnpm astro check
pnpm build
# 需在 GitHub Settings → Secrets and variables → Actions 配置：
# CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / BETTER_AUTH_SECRET / GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
```

> 完成以上 8 步 + 本节命令校验，`https://mizuki-blog.<子域>.workers.dev` 即为 Mizuki 完整版（含 GitHub 登录、后台、评论楼中楼、搜索、SEO），后续推送到 `main` 会自动重新 Build/Deploy（见 `.github/workflows/ci.yml`）。
