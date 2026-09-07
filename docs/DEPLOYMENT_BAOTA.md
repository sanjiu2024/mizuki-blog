# 宝塔面板部署手册 — Mizuki Blog（Astro 7 SSR → Node.js + PM2 + Nginx）

> 适配自 Cloudflare Workers 版（`@astrojs/cloudflare` + D1/KV）到宝塔 VPS 版（`@astrojs/node` + `better-sqlite3` + PM2）。全程面板点选，无需手写 `nginx.conf`。

---

## 0. 架构变化

| Cloudflare 版                        | 宝塔版                                                            |
| ------------------------------------ | ----------------------------------------------------------------- |
| `adapter: cloudflare()`              | `adapter: node({ mode: "standalone" })`                           |
| `drizzle-orm/d1` + `env.DB` (D1)     | `drizzle-orm/better-sqlite3` + `new Database("./data/mizuki.db")` |
| `KV SESSION`                         | 文件系统 Session（better-auth 会话已在 DB）                       |
| `wrangler.jsonc` + `wrangler deploy` | `ecosystem.config.cjs` + `pm2` + Nginx 反代                       |

> D1 本质就是 SQLite（含 FTS5 `porter unicode61`），`migrations/*.sql` 无需修改，`better-sqlite3` 直接可用。`better-auth` 的 `drizzleAdapter` 零改动。

---

## 1. 环境准备（宝塔面板）

### 1.1 安装必备软件

| 组件           | 版本要求                                                     | 宝塔位置                                       |
| -------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| 宝塔面板       | 11.0+                                                        | -                                              |
| Node版本管理器 | 2.7+                                                         | 软件商店 → 搜索 `Node版本管理器` → 安装        |
| Node.js        | **v22 LTS**（`package.json` 要求 `>=22.12.0`，Astro 7 必需） | Node版本管理器 → 安装 `v22.x` → 设为命令行版本 |
| Nginx          | 1.20+                                                        | 软件商店 → 安装                                |
| PM2            | 随 Node版本管理器自动安装                                    | 终端 `pm2 -v` 验证                             |

```bash
node -v  # 期望 v22.x
which node  # /www/server/nodejs/v22.x.x/bin/node
npm i -g pnpm@10
pnpm -v
pm2 -v
```

### 1.2 放行端口

- 宝塔 → 安全 → 防火墙：放行 `80` / `443`（外网），`4321` 无需外网放行（仅本机 `127.0.0.1:4321`）
- 云厂商安全组（阿里云/腾讯云）：同样放行 `80` / `443`

---

## 2. 代码适配（D1 → 本地 SQLite）

### 2.1 切换适配器

```bash
pnpm remove @astrojs/cloudflare wrangler
pnpm add @astrojs/node better-sqlite3
pnpm add -D @types/better-sqlite3
```

### 2.2 `astro.config.mjs`

```js
// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://blog.example.com", // 改为你的宝塔域名
  output: "server",
  adapter: node({ mode: "standalone" }),
  vite: { plugins: [tailwindcss()] },
});
```

### 2.3 `src/db/client.ts`

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const path = process.env.DB_FILE_NAME ?? "./data/mizuki.db";
const sqlite = new Database(path);
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite, { schema });
export type Db = typeof db;
```

### 2.4 `src/auth.ts`

- 删除 `if (!env.DB) throw` 检查
- 改为 `import { db } from "./db/client"` → `drizzleAdapter(db, { provider: "sqlite", schema })`
- `baseURL` / `trustedOrigins` 改为 `process.env.BETTER_AUTH_URL`（宝塔域名）
- 删除 `KV SESSION` 相关，better-auth 会话已在 SQLite

### 2.5 `drizzle.config.ts`

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dbCredentials: { url: "./data/mizuki.db" },
});
```

### 2.6 `package.json` scripts

```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "start": "node ./dist/server/entry.mjs",
    "db:push": "drizzle-kit push",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  }
}
```

删除 `db:migrate:local` / `db:migrate:remote` / `deploy`（wrangler 相关）。

### 2.7 创建数据目录（关键）

```bash
mkdir -p /www/wwwroot/mizuki-blog/data
mkdir -p /www/wwwroot/mizuki-blog/logs
chown -R www:www /www/wwwroot/mizuki-blog/data
chown -R www:www /www/wwwroot/mizuki-blog/logs
chmod 755 /www/wwwroot/mizuki-blog/data
```

> 宝塔的 Node 项目默认以 `www` 用户运行，若 `data/` 非 `www` 可写会报 `SQLITE_CANTOPEN`。

---

## 3. 构建

```bash
cd /www/wwwroot/mizuki-blog
pnpm install --frozen-lockfile
pnpm astro check
pnpm build  # 产物 dist/server/entry.mjs + dist/client/
pnpm exec drizzle-kit push  # 生成 ./data/mizuki.db（或 drizzle-kit migrate）
# 验证
sqlite3 ./data/mizuki.db "SELECT name FROM sqlite_master WHERE type='table';"
# 应看到 users/posts/tags/post_tags/comments/comment_reactions/session/account/verification + posts_fts
chown www:www ./data/mizuki.db
chown www:www ./data/mizuki.db-wal 2>/dev/null || true
chown www:www ./data/mizuki.db-shm 2>/dev/null || true
```

---

## 4. PM2 部署（两种方式二选一）

### 方式 A：宝塔面板点选（推荐新手）

1. 宝塔 → 网站 → Node项目 → **添加Node项目**
2. 填写：
   - **项目名称**：`mizuki-blog`
   - **项目路径**：`/www/wwwroot/mizuki-blog`
   - **启动文件**：`dist/server/entry.mjs`
   - **项目端口**：`4321`
   - **Node版本**：`v22.x`
   - **运行用户**：`www`
   - **包管理器**：`pnpm`
3. 提交后等待启动，测试 `curl -I http://127.0.0.1:4321` 应 `200`
4. 环境变量在 **项目设置 → 环境变量** 添加：
   - `HOST=127.0.0.1`
   - `PORT=4321`
   - `DB_FILE_NAME=./data/mizuki.db`
   - `BETTER_AUTH_SECRET=openssl rand -base64 32` 生成的一串
   - `BETTER_AUTH_URL=https://blog.example.com`
   - `GITHUB_CLIENT_ID=Ov23...`
   - `GITHUB_CLIENT_SECRET=xxx`

### 方式 B：配置文件（推荐生产，可进 git）

`ecosystem.config.cjs`（放项目根）：

```js
module.exports = {
  apps: [
    {
      name: "mizuki-blog",
      script: "./dist/server/entry.mjs",
      cwd: "/www/wwwroot/mizuki-blog",
      instances: 1,
      exec_mode: "fork", // 单文件 SQLite 必须 fork + 1 实例，勿用 cluster
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "4321",
        DB_FILE_NAME: "./data/mizuki.db",
        BETTER_AUTH_SECRET: "openssl rand -base64 32 生成",
        BETTER_AUTH_URL: "https://blog.example.com",
        GITHUB_CLIENT_ID: "Ov23...",
        GITHUB_CLIENT_SECRET: "xxx",
      },
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
```

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # 按提示执行 sudo env 那一行
pm2 status  # 应显示 online
pm2 logs mizuki-blog --lines 20  # 期望 Server listening on http://127.0.0.1:4321
curl -I http://127.0.0.1:4321  # 200
```

> **SQLite 注意**：`instances: 1` + `fork`，`cluster`/`max` 会多进程抢写 `.db-wal` 导致 `SQLITE_BUSY`。要扩容先迁 PostgreSQL。

---

## 5. Nginx 反向代理

### 面板点选（推荐）

1. 宝塔 → 网站 → 选中 `blog.example.com` → **反向代理** → **添加反向代理**
   - **代理名称**：`mizuki`
   - **目标URL**：`http://127.0.0.1:4321`
   - **发送域名**：`$host`
2. 保存后测试 `https://blog.example.com` 应显示 Mizuki 首页

### 等价手写（`nginx.conf`）

```nginx
server {
  listen 80;
  server_name blog.example.com;

  # 静态资源直供（可选，standalone 已自带，但 Nginx 更快）
  location /_astro/ {
    alias /www/wwwroot/mizuki-blog/dist/client/_astro/;
    expires 1y;
    add_header Cache-Control "public, immutable";
    access_log off;
  }

  location / {
    proxy_pass http://127.0.0.1:4321;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

---

## 6. HTTPS（Let's Encrypt）

1. 宝塔 → 网站 → 选中 `blog.example.com` → **SSL** → **Let's Encrypt**
2. 勾选 `blog.example.com` + `www.blog.example.com`（如有）
3. 验证方式选 **文件验证** → **申请**
4. 申请成功后开启 **强制HTTPS**
5. 宝塔自动续期（90 天），`BETTER_AUTH_URL` 同步改为 `https://blog.example.com`
6. GitHub OAuth 回调追加：`https://blog.example.com/api/auth/callback/github`（在 https://github.com/settings/developers → 你的 OAuth App → Authorization callback URL）

---

## 7. 常用运维

```bash
pm2 status          # 查看状态
pm2 logs mizuki-blog # 实时日志
pm2 restart mizuki-blog
pm2 reload mizuki-blog  # 零停机重载
pm2 stop mizuki-blog

# 更新代码后
git pull
pnpm install --frozen-lockfile
pnpm build
pm2 restart mizuki-blog

# 备份数据库
cp ./data/mizuki.db ./data/mizuki.db.bak.$(date +%Y%m%d)
sqlite3 ./data/mizuki.db ".dump" > ./data/dump.sql
```

---

## 8. 排错表

| 现象                        | 原因                                    | 修复                                                                    |
| --------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `502 Bad Gateway`           | 端口填错 / Node 未监听 `127.0.0.1:4321` | `pm2 logs` 看 `Server listening` 端口，回填外网映射的内网端口           |
| `SQLITE_CANTOPEN`           | `data/` 非 `www` 可写                   | `chown -R www:www data && chmod 755 data`                               |
| `Error: D1 binding missing` | 忘改 `auth.ts` / `client.ts`            | 按 §2 换 `better-sqlite3`                                               |
| `sharp` 报错                | 宝塔缺 `python/make/gcc`                | Node版本管理器切 `v22` 重装，或 `pnpm add sharp --ignore-scripts=false` |
| `502` 静态 `_astro` 404     | 走了 `middleware` 模式                  | 切 `standalone` 重 `pnpm build`                                         |
| `better-auth` 500           | `BETTER_AUTH_SECRET` 未设或过短         | `openssl rand -base64 32` 重新生成并填入 PM2 环境变量                   |
| `GitHub OAuth 404`          | 回调 URL 未追加 https 域名              | GitHub App 回调改为 `https://blog.example.com/api/auth/callback/github` |

---

## 9. 与 Cloudflare 版的对比

|            | Cloudflare Workers                     | 宝塔 Node                                |
| ---------- | -------------------------------------- | ---------------------------------------- |
| 适配器     | `@astrojs/cloudflare`                  | `@astrojs/node (standalone)`             |
| 数据库     | D1（`env.DB`）                         | `better-sqlite3` 文件 `./data/mizuki.db` |
| 会话       | KV `SESSION`                           | 文件系统（better-auth 存 DB）            |
| 部署       | `wrangler deploy` / Dashboard 自动构建 | `pm2` + Nginx 反代                       |
| 域名/HTTPS | Workers 自定义域                       | 宝塔 Nginx + Let's Encrypt               |
| 日志       | `wrangler tail` / Dashboard Logs       | `pm2 logs` + `./logs/`                   |

> 后续若从宝塔迁回 Cloudflare，只需反向执行 §2（换回 `cloudflare` 适配器 + `d1`），`migrations` 与 `schema.ts` 无需改动。
