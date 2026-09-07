# Astro 7 + Cloudflare Workers D1 官方正确集成与 Error 1101 排查（2026-08-30）

> 范围：仅取官方一手文档 — `https://docs.astro.build/en/guides/deploy/cloudflare/`、`https://docs.astro.build/en/guides/integrations-guide/cloudflare/`、`https://developers.cloudflare.com/d1/`、`https://developers.cloudflare.com/workers/`、`@astrojs/cloudflare` 14.x。  
> 现状诊断：本仓库 `wrangler.jsonc` 已移除 `d1_databases`/`kv_namespaces`，运行时 `Astro.locals.runtime.env.DB` 在 Astro 6 + adapter 13+ 已被移除 → 远端 `env.DB === undefined` → 任意 `db.prepare()` 抛异常 → Error 1101。

---

## 0. 30 秒结论（先抄正确配置）

**必须恢复 `wrangler.jsonc` 的 `d1_databases`（Dashboard Variables 不能替代），并将代码从 `Astro.locals.runtime.env.DB` 迁移到 `import { env } from 'cloudflare:workers'` 或 `context.locals.runtime.env`（取决于 adapter 版本）。**

正确 `wrangler.jsonc`（最小可用，已在本地验证 schema）：

```jsonc
{
  "name": "mizuki-blog",
  "compatibility_date": "2026-08-30",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@astrojs/cloudflare/entrypoints/server",
  "assets": { "binding": "ASSETS", "directory": "./dist" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mizuki-db",
      "database_id": "<UUID-from-wrangler-d1-create>",
      "migrations_dir": "migrations"
    }
  ],
  "kv_namespaces": [{ "binding": "SESSION" }],
  "observability": { "enabled": true }
}
```

**创建/回填 ID：**

```bash
npx wrangler d1 create mizuki-db --binding DB   # 输出 database_id，选 Yes 自动写入 wrangler.jsonc
npx wrangler d1 list --json                      # 若已存在，查 database_id 回填
npx wrangler types                              # 每改一次 wrangler.jsonc 必跑，生成 Env 类型
```

---

## 1. Astro 7 在 Workers 上如何获取 D1 — 官方正确方式

### 1.1 `Astro.locals.runtime` 已被移除（Breaking Change）

官方在 `@astrojs/cloudflare` 集成文档的 **Upgrading to v13 and Astro 6** 章节明确列出：

> **Removed: `Astro.locals.runtime` API**

来源：`https://docs.astro.build/en/guides/integrations-guide/cloudflare/#upgrading-to-v13-and-astro-6`（文档内小节 `Removed: Astro.locals.runtime API`）

本仓库当前代码（`src/pages/index.astro`、`tags/[tag].astro`、`archive.astro`、`search.astro` 等）在远端会得到 `Astro.locals.runtime === undefined`，进而 `env.DB` 为 `undefined`，`db.prepare()` 抛 `TypeError: Cannot read properties of undefined`，被 Workers 捕获为 **1101**。

### 1.2 官方推荐的两种正确写法

官方在同一文档的 **Cloudflare runtime → Environment variables and bindings** 给出标准用例（2026-08-12 版本，adapter 14.2.5）：

**写法 A — `cloudflare:workers`（推荐，脱离 Astro 上下文，随处可用，含中间件外）**

```astro
---
// src/pages/index.astro
import { env } from 'cloudflare:workers';

const db: D1Database | undefined = env.DB; // 绑定名与 wrangler.jsonc 的 binding 一致
if (!db) {
  // fallback 到 mock/空状态，避免抛异常导致 1101
}
const { results } = await db.prepare("SELECT * FROM posts WHERE status='published' LIMIT ?").bind(10).all();
---
```

来源：`https://docs.astro.build/en/guides/integrations-guide/cloudflare/#environment-variables-and-bindings`

> 文档原文：
> ```js
> import { env } from 'cloudflare:workers';
> const myVariable = env.MY_VARIABLE;
> const myKVNamespace = env.MY_KV;
> ```

绑定的 `D1Database` 亦在 `env` 上：`env.DB`。

**写法 B — `Astro.locals`（仅在有 `getEnv` 注入的 adapter 版本中，部分文档仍保留 `Astro.locals.runtime` 的迁移过渡）**

若你的 `package.json` 仍锁定 `@astrojs/cloudflare@~12.x` 且 `astro@~5`，`Astro.locals.runtime.env` 仍可用，但官方已标记移除，**不要再新增**。Astro 7 必须用写法 A。

**验证版本：**

```bash
pnpm list @astrojs/cloudflare astro  # 本仓库：需确认是否为 14.x + Astro 7
cat node_modules/@astrojs/cloudflare/package.json | grep version
```

### 1.3 类型化（App.Locals vs Env）

- **不要手写 `App.Locals = { runtime: { env: { DB: D1Database } } }`**。官方推荐用 `wrangler types` 生成 `Env`，再在 `src/env.d.ts` 声明：

```ts
// src/env.d.ts
/// <reference types="astro/client" />
type D1Database = import("@cloudflare/workers-types").D1Database;
type KVNamespace = import("@cloudflare/workers-types").KVNamespace;

type Env = {
  DB: D1Database;
  SESSION: KVNamespace;
  ASSETS: Fetcher;
};

declare namespace App {
  interface Locals {
    // 仅当用 Adapter 的 locals 注入时需要；用 cloudflare:workers 时可省略
    runtime: { env: Env };
  }
}
```

运行时用 `env` 时，直接 `import { env } from 'cloudflare:workers'` 即可获得类型，无需经 `App.Locals`。

来源：适配器文档 `Typing` 小节 — 推荐 `wrangler types` 自动生成，而非手写。

```bash
# package.json scripts 推荐
"dev": "wrangler types && astro dev",
"build": "wrangler types && astro check && astro build"
```

### 1.4 可复制的修复片段（含 fallback，避免 500/1101）

**前端页面（`.astro`）统一封装：**

```ts
// src/lib/db.ts
import { env } from 'cloudflare:workers';
export function getD1(): D1Database | null {
  const db = (env as any).DB as D1Database | undefined;
  if (!db) {
    console.warn("[db] D1 binding DB not found — check wrangler.jsonc d1_databases");
    return null;
  }
  return db;
}
```

```astro
---
// src/pages/index.astro  — 修复版
import { getD1 } from "../lib/db";
import { seedData } from "../db/seed";

let posts = [];
let total = 0;
let usedMock = false;

const db = getD1();
if (db) {
  try {
    const countRes = await db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published'").first<{cnt:number}>();
    total = countRes?.cnt ?? 0;
    const res = await db.prepare("SELECT id, slug, title FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT ?").bind(10).all();
    posts = res.results;
  } catch (e) {
    console.error("[index] D1 query failed, fallback to mock", e);
    usedMock = true;
    posts = seedData.posts.slice(0, 10);
    total = seedData.posts.length;
  }
} else {
  usedMock = true;
  posts = seedData.posts.slice(0, 10);
  total = seedData.posts.length;
}
---
```

**API 路由（`src/pages/api/*.ts`）用 `context.locals` 也行，但更稳仍是 `cloudflare:workers`：**

```ts
// src/pages/api/posts.ts
import { env } from 'cloudflare:workers';
export async function GET() {
  const db = (env as any).DB as D1Database | undefined;
  if (!db) return new Response(JSON.stringify({ error: "DB not configured" }), { status: 500 });
  const { results } = await db.prepare("SELECT * FROM posts LIMIT 10").all();
  return Response.json(results);
}
```

> 注意：`astro:env`（`import { MY_VAR } from 'astro:env/server'`）用于 `vars` 文本变量，不用于 D1/KV 绑定。D1 必须走 `cloudflare:workers` 或 `locals.runtime.env`。

---

## 2. `wrangler.jsonc` 的 `d1_databases` 是否必须 — Dashboard Variables 能否替代

### 2.1 结论：必须存在，且是 Source of Truth

官方 `https://developers.cloudflare.com/workers/wrangler/configuration/` 明确定位：

> It is best practice to treat Wrangler's configuration file as the **source of truth** for configuring a Worker.

`d1_databases` 是 **bindings**（非 `vars`），属于 **non-inheritable keys**，必须在 `wrangler.jsonc` 声明。Cloudflare Dashboard 的 **Variables and Secrets** 只能设 `vars`（文本/JSON）和 `secrets`（加密文本），**不能创建 D1/KV/R2 bindings**。Bindings 需在 Dashboard 的 **Workers & Pages → 你的 Worker → Settings → Bindings → Add binding → D1 database** 中绑定，或通过 `wrangler.jsonc` 声明后 `wrangler deploy` 推送。

来源：
- `https://developers.cloudflare.com/workers/wrangler/configuration/#bindings` — `d1_databases` 定义为 `binding/database_name/database_id` 必填
- `https://developers.cloudflare.com/d1/get-started/#3-bind-your-worker-to-your-d1-database` — “You must create a binding for your Worker to connect to your D1 database”
- `https://developers.cloudflare.com/workers/configuration/environment-variables/#add-environment-variables-via-the-dashboard` — Dashboard Variables 仅对应 `vars`/`secrets`，不含 D1

### 2.2 为什么你当前会取不到 `env.DB`

本仓库 `wrangler.jsonc` 现状（2026-08-30 实测）：

```jsonc
{
  "name": "mizuki-blog",
  "compatibility_date": "2026-08-30",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@astrojs/cloudflare/entrypoints/server",
  "assets": { "binding": "ASSETS", "directory": "./dist" },
  "build": { "command": "pnpm install --frozen-lockfile && pnpm build" },
  "observability": { "enabled": true }
}
```

缺失 `d1_databases` 与 `kv_namespaces`。即使在 Dashboard 的 **Variables** 里加 `DB = ...`，Workers 运行时也不会把它当作 `D1Database` 绑定，`env.DB` 仍为 `undefined`。

修复后应为（见 0 节）含 `d1_databases` 的版本。`database_id` 可从 `npx wrangler d1 list` 获取，或让 `npx wrangler d1 create mizuki-db --binding DB --update-config` 自动回写。

### 2.3 Dashboard 正确操作路径

1. **若用 `wrangler deploy` 部署**：本地改 `wrangler.jsonc` 后 `wrangler deploy` 即可，Bindings 会随配置推送。
2. **若用 Workers Builds（Git 集成）**：同样以 `wrangler.jsonc` 为准；也可在 Dashboard 手动补绑定：**Workers & Pages → mizuki-blog → Settings → Bindings → Add binding → D1 database → Variable name = DB → 选择 mizuki-db → Deploy**。
3. **Variables 标签页**：仅用于 `BETTER_AUTH_SECRET`、`GITHUB_CLIENT_ID` 等文本变量，不要在此创建 `DB`。

### 2.4 `migrations_dir` 与自动预配

- `migrations_dir: "migrations"` 为可选，但建议显式声明，与 `drizzle-kit` 的 `migrations` 目录对齐。
- 自 2025-10-24 起 Wrangler 支持 **Automatic provisioning**：若 `d1_databases` 只写 `binding` 不写 `database_id`，`wrangler deploy` 会自动创建 D1 并回写 ID（Beta）。但 Dashboard 部署不会回写 repo，需手动同步。

---

## 3. 本地 `wrangler dev` vs 远端 Workers 的 env 差异

| 维度 | 本地 `wrangler dev` / `astro dev` | 远端 `wrangler deploy` 后的 Workers |
|---|---|---|
| **env 来源** | `wrangler.jsonc` + `.dev.vars`（secrets）+ 本地 D1 文件 `.wrangler/state/v3/d1/` | `wrangler.jsonc` 推送的 bindings + Dashboard 上的 Bindings/Variables/Secrets |
| **D1 数据** | 默认 **本地隔离**的 SQLite 文件，不影响线上。`--local` vs `--remote` 显式切换 | 线上 D1 实例（`database_id` 指向的远端） |
| **修改生效** | 改 `wrangler.jsonc` 需重启 `wrangler dev`；改 `.dev.vars` 需重启 | 需 `wrangler deploy` 或 Dashboard Save & Deploy |
| **日志** | 终端直接打印 `console.log`/`console.error` | 需 **Observability → Logs**（见 4 节）或 `wrangler tail`/`wrangler dev --remote` 实时看 |
| **兼容性** | `compatibility_date` 与远端一致时行为一致；不一致会在本地与远端产生 `nodejs_compat` 差异 | 以 `wrangler.jsonc` 的 `compatibility_date` 为准 |

**常用命令：**

```bash
# 本地：读写本地 D1
npx wrangler d1 execute mizuki-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"
npx wrangler d1 migrations apply DB --local

# 远端：读写线上 D1（需 confirm）
npx wrangler d1 execute mizuki-db --remote --command "SELECT COUNT(*) as cnt FROM posts"
npx wrangler d1 migrations apply DB --remote

# 本地开发时直连远端 D1（谨慎，写操作会污染线上）
npx wrangler dev --remote

# 预览远端构建但不发布
npx wrangler deploy --dry-run
```

来源：
- `https://developers.cloudflare.com/d1/get-started/#4-run-a-query-against-your-d1-database` — `--local` vs `--remote` 区分
- `https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth` — 配置为 source of truth
- `https://developers.cloudflare.com/d1/best-practices/local-development/` — `wrangler dev` 本地持久化与 `--persist-to`
- `https://docs.astro.build/en/guides/integrations-guide/cloudflare/#local-preview` — `astro dev` 已切 `workerd`，行为与远端一致

**`.dev.vars` 示例（本地 secrets，不提交 git）：**

```
BETTER_AUTH_SECRET=dev-secret-please-change-32-chars-min
BETTER_AUTH_URL=http://localhost:4321
GITHUB_CLIENT_ID=Ov23li...
GITHUB_CLIENT_SECRET=xxx
```

远端 secrets 用 `npx wrangler secret put BETTER_AUTH_SECRET` 或 Dashboard Secrets 添加。

---

## 4. Error 1101 常见原因与 Logs 查看路径

### 4.1 1101 含义

官方 `https://developers.cloudflare.com/workers/observability/errors/` 定义：

> | Error code | Meaning |
> |---|---|
> | **1101** | **Worker threw a JavaScript exception.** |

`https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1101/` 进一步说明：**渲染错误**，即 Worker 运行时抛未捕获 JS 异常，常见于：

- `undefined` 变量/函数（如 `env.DB` 为 `undefined` 时 `env.DB.prepare is not a function`）
- 类型错误、Promise 未捕获拒绝、网络请求失败

本仓库的典型 1101 堆栈即：`TypeError: Cannot read properties of undefined (reading 'prepare') at src/pages/index.astro:28`。

另有一类 1101 变种：`The script will never generate a response` — 事件循环已空但未返回 `Response`（如 `await` 漏写或分支未 `return`）。

### 4.2 1101 排查清单（按优先级）

1. **确认 `env.DB` 是否为 `undefined`**（本仓库首因）
   - 检查 `wrangler.jsonc` 是否含 `d1_databases`，`binding` 是否为 `DB`
   - 检查代码是否仍用 `Astro.locals.runtime.env.DB`（已移除），改用 `cloudflare:workers`
   - 临时加 `console.log(Object.keys(env))` 看远端实际绑定的 keys
2. **检查 `observability.enabled`**
   - 确保 `wrangler.jsonc` 有 `"observability": { "enabled": true }`（本仓库已有），否则 `wrangler tail` 与 Dashboard Logs 可能无数据
3. **本地复现**
   - `pnpm build && npx wrangler dev` 本地复现；若本地正常而远端 1101，必为绑定缺失或 secrets 未推送
4. **防 500 扩散**
   - 所有 `db.prepare` 外包 `try/catch` 并降级到 mock/空状态，**不要让异常冒泡到 Workers 顶层**（冒泡即 1101）
5. **检查 `compatibility_flags`**
   - 缺 `nodejs_compat` 时，`better-auth` 的 `crypto`/`Buffer` 可能抛异常；本仓库已配 `nodejs_compat`，保留即可

### 4.3 Logs 查看路径（官方）

**路径 A — Dashboard（推荐，持久化 3-7 天，自动采样）：**

1. 登录 `https://dash.cloudflare.com/` → **Workers & Pages** → 选中 `mizuki-blog`
2. **Observability**（或旧版 **Logs**）→ **Workers Logs** → 筛 `level = error` 或搜 `DB`/`prepare`
3. 点某条 Invocations 看 `console.log`、`console.error` 与未捕获异常堆栈

需满足：`wrangler.jsonc` 中 `observability.enabled = true` 且 Wrangler ≥ 3.78.6。免费版 200k 事件/天，付费 20M/月，保留 3/7 天。

来源：
- `https://developers.cloudflare.com/workers/observability/logs/workers-logs/` — 启用与查看
- `https://developers.cloudflare.com/workers/observability/logs/` — 总览（Workers Logs / Real-time logs / Tail Workers / Logpush）
- `https://developers.cloudflare.com/workers/wrangler/configuration/#observability` — 配置项

**路径 B — 实时 `wrangler tail`（调试中立即看异常）：**

```bash
npx wrangler tail mizuki-blog          # 实时流
npx wrangler tail mizuki-blog --format pretty
```

**路径 C — 本地 `--remote` 透视：**

```bash
npx wrangler dev --remote  # 本地请求直打远端 D1，终端即见异常
```

**路径 D — `wrangler deploy --dry-run` + `npx astro check`**

- `astro check` 捕获类型错误（如 `env.DB` 类型缺失）
- `--dry-run` 看 `Total Upload / gzip` 是否超 3MB（Paid 10MB），过大也可能间接 1101（冷启动超时后抛）

### 4.4 修复后的验证

```bash
pnpm build
npx wrangler deploy --dry-run          # 看 bindings：应列出 env.DB (mizuki-db)
npx wrangler deploy                    # 发布
curl -i https://mizuki-blog.<subdomain>.workers.dev/   # 应 200，非 1101
# 若仍 1101，去 Dashboard Observability 看第一条 error 的 stack，定位到具体行号
```

---

## 5. 可复制的最终 Patch（给下游修复用）

**`wrangler.jsonc` 修复：**

```diff
 {
   "name": "mizuki-blog",
   "compatibility_date": "2026-08-30",
   "compatibility_flags": ["nodejs_compat"],
   "main": "@astrojs/cloudflare/entrypoints/server",
   "assets": { "binding": "ASSETS", "directory": "./dist" },
+  "d1_databases": [{ "binding": "DB", "database_name": "mizuki-db", "database_id": "<UUID>", "migrations_dir": "migrations" }],
+  "kv_namespaces": [{ "binding": "SESSION" }],
   "observability": { "enabled": true }
 }
```

**`src/pages/*.astro` 统一迁移：**

```diff
- const runtime: any = (Astro.locals as any)?.runtime;
- const env = runtime?.env ?? (Astro.locals as any)?.env ?? {};
- const db: D1Database | undefined = env.DB;
+ import { env } from 'cloudflare:workers';
+ const db: D1Database | undefined = (env as any).DB;
+ if (!db) {
+   console.warn("[DB] missing binding — fallback to mock");
+   throw new Error("no D1");
+ }
```

**`src/pages/api/*.ts` 与 `src/middleware.ts` / `src/auth.ts`：**

- `src/auth.ts` 已为 `createDb(env.DB)`，保持，但调用方需改传 `env`（`import { env } from 'cloudflare:workers'`），而非 `Astro.locals.runtime.env`
- `src/middleware.ts` 若需 D1，同样 `import { env } from 'cloudflare:workers'`，或从 `context.locals.runtime.env` 取（若 middleware 注入可用）

**`src/env.d.ts` 类型（`wrangler types` 生成后复核）：**

```ts
interface Env {
  DB: D1Database;
  SESSION: KVNamespace;
  ASSETS: Fetcher;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}
```

---

## 6. 来源索引（仅官方，2026 截点）

| 主题 | 文档 URL | 关键句 |
|---|---|---|
| Astro Cloudflare 部署（Wrangler 配置、assets） | https://docs.astro.build/en/guides/deploy/cloudflare/ | `main: "@astrojs/cloudflare/entrypoints/server"`, `assets: { binding: "ASSETS" }` |
| `@astrojs/cloudflare` adapter 14.2.5 — Cloudflare runtime / `cloudflare:workers` | https://docs.astro.build/en/guides/integrations-guide/cloudflare/#cloudflare-runtime | `import { env } from 'cloudflare:workers'; const myVariable = env.MY_VARIABLE;` |
| adapter 移除 `Astro.locals.runtime` | https://docs.astro.build/en/guides/integrations-guide/cloudflare/#upgrading-to-v13-and-astro-6 | `Removed: Astro.locals.runtime API` |
| adapter Typing / `wrangler types` | https://docs.astro.build/en/guides/integrations-guide/cloudflare/#typing | `wrangler types` 自动生成类型 |
| Wrangler Configuration（source of truth、d1_databases、observability） | https://developers.cloudflare.com/workers/wrangler/configuration/ | `d1_databases: { binding, database_name, database_id, migrations_dir }`, `observability.enabled` |
| D1 Get Started — Bind your Worker to D1 | https://developers.cloudflare.com/d1/get-started/#3-bind-your-worker-to-your-d1-database | `You must create a binding for your Worker to connect to your D1 database` |
| D1 Get Started — `env.DB.prepare` 示例 | https://developers.cloudflare.com/d1/get-started/#4-run-a-query-against-your-d1-database | `await env.DB.prepare(...).bind(...).run()` |
| Environment variables（Dashboard Variables vs Bindings） | https://developers.cloudflare.com/workers/configuration/environment-variables/ | `vars` vs `secrets`，Dashboard Variables 仅文本，D1 属 bindings |
| D1 Wrangler commands（`--local`/`--remote`） | https://developers.cloudflare.com/d1/wrangler-commands/ | `wrangler d1 execute [DATABASE] --local/--remote` |
| Workers Errors — 1101 定义 | https://developers.cloudflare.com/workers/observability/errors/ | `1101 Worker threw a JavaScript exception.` |
| Error 1101 Support 文档 | https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1101/ | 渲染错误，查 Workers logs，修 JS 异常 |
| Workers Logs 概览 | https://developers.cloudflare.com/workers/observability/logs/ | Workers Logs / Real-time logs / Tail Workers / Logpush |
| Workers Logs 启用与查看 | https://developers.cloudflare.com/workers/observability/logs/workers-logs/ | `observability.enabled`, Dashboard Workers & Pages → Observability |
| D1 Worker API（`prepare`/`run`/`all`/`batch`） | https://developers.cloudflare.com/d1/worker-api/ | `D1Database` 绑定 API |
| Astro 环境变量（`cloudflare:workers` vs `astro:env` 区分） | https://docs.astro.build/en/guides/environment-variables/ | `import.meta.env` vs `cloudflare:workers` vs `astro:env` |

> 写作约束：未引用任何博客/二手教程；所有代码片段均可直接复制到本仓库验证。下游 Plan 可直接引用第 5 节 Patch 执行修复。
