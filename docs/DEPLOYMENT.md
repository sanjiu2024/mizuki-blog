# Deployment — Cloudflare Workers

## 本地

```bash
pnpm install
pnpm dev                    # http://localhost:4321
# D1 本地（需 workerd 支持，沙盒可能报 tcmalloc，远端不受影响）
pnpm db:migrate:local
wrangler d1 execute mizuki-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"
```

## 远端 Workers

```bash
wrangler login
# 首次创建 D1/KV（或让 wrangler 自动创建）
wrangler d1 create mizuki-db --update-config
# 迁移
pnpm db:migrate:remote
# 部署
pnpm build
wrangler deploy --dry-run   # 体积 530 KiB gzip ✅
wrangler deploy
```

`wrangler.jsonc` 关键字段：

```jsonc
{
  "name": "mizuki-blog",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-08-30",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "binding": "ASSETS", "directory": "./dist" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mizuki-db",
      "migrations_dir": "migrations",
    },
  ],
  "kv_namespaces": [{ "binding": "SESSION", "id": "local-session" }],
}
```

## 环境变量

| 变量                   | 必填            | 说明                                                                             |
| ---------------------- | --------------- | -------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`   | ✅              | 32+ 字符，`.dev.vars` 本地，GitHub Secrets / `wrangler secret put` 远端          |
| `BETTER_AUTH_URL`      | ✅              | 本地 `http://localhost:4321`，远端为 Workers URL `https://<workers>.workers.dev` |
| `GITHUB_CLIENT_ID`     | GitHub 登录需要 | GitHub OAuth App 的 Client ID                                                    |
| `GITHUB_CLIENT_SECRET` | GitHub 登录需要 | GitHub OAuth App 的 Client Secret（必须用 `wrangler secret put`）                |

`.dev.vars` 示例：

```
BETTER_AUTH_SECRET=dev-secret-please-change-32-chars-min
BETTER_AUTH_URL=http://localhost:4321
GITHUB_CLIENT_ID=Ov23liXXXXXXXX
GITHUB_CLIENT_SECRET=abc123...
```

远端设置：

```bash
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put GITHUB_CLIENT_SECRET
# GITHUB_CLIENT_ID 可放 vars 或 secret
wrangler deploy
```

## GitHub OAuth App 创建

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
2. 填写：
   - Application name: `mizuki-blog`
   - Homepage URL: `https://<your-workers>.workers.dev`
   - Authorization callback URL: `https://<your-workers>.workers.dev/api/auth/callback/github`
3. 本地开发需再创建一个或在同一 App 的回调中追加（GitHub 仅支持一个回调 URL，推荐做法：开发用单独的 OAuth App，回调设为 `http://localhost:4321/api/auth/callback/github`）
   > 替代方案：本地用 `.dev.vars` 指向远端回调并通过代理，但最稳妥是建两个 App。
4. 生成后将 Client ID / Secret 写入上表位置。

回调路径固定为 `/api/auth/callback/github`，由 `better-auth` 自动处理，不可自定义。

## 自定义域

Dashboard `Workers & Pages → mizuki-blog → Settings → Domains & Routes → Add Custom Domain`，自动 DNS + Advanced Certificate。

## CI

`.github/workflows/ci.yml`：`pnpm install → astro check → build`，`main` 分支自动 `wrangler deploy`（需 `CLOUDFLARE_API_TOKEN` / `ACCOUNT_ID` / `BETTER_AUTH_SECRET` / `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`）。

## 故障

- `wrangler d1 --local` 在受限沙盒报 `tcmalloc` / `EPIPE` 为 workerd 内存限制，非 SQL 错误，远端正常。
- `better-auth` 需 `nodejs_compat`，漏配会报 `node:crypto` not found。
- GitHub 回调 404：检查 `BETTER_AUTH_URL` 是否与实际访问域一致，回调 URL 是否精确为 `.../api/auth/callback/github`。
