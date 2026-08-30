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
  "d1_databases": [{ "binding": "DB", "database_name": "mizuki-db", "migrations_dir": "migrations" }],
  "kv_namespaces": [{ "binding": "SESSION", "id": "local-session" }]
}
```

## 环境变量

- `BETTER_AUTH_SECRET`（32+ 字符，`.dev.vars` 本地，GitHub Secrets 远端）
- `BETTER_AUTH_URL`（本地 `http://localhost:4321`，远端为 Workers URL）

## 自定义域

Dashboard `Workers & Pages → mizuki-blog → Settings → Domains & Routes → Add Custom Domain`，自动 DNS + Advanced Certificate。

## CI

`.github/workflows/ci.yml`：`pnpm install → astro check → build`，`main` 分支自动 `wrangler deploy`（需 `CLOUDFLARE_API_TOKEN` / `ACCOUNT_ID` / `BETTER_AUTH_SECRET`）。

## 故障

- `wrangler d1 --local` 在受限沙盒报 `tcmalloc` / `EPIPE` 为 workerd 内存限制，非 SQL 错误，远端正常。
- `better-auth` 需 `nodejs_compat`，漏配会报 `node:crypto` not found。
