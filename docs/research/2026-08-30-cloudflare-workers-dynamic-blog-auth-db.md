# Cloudflare Workers 动态博客：鉴权与数据库权威方案（2026-08-30）

> 目标：Mizuki 风格动态博客（非静态），需登录 + 发评论，部署至 Cloudflare Workers。  
> 范围：基于 2025-2026 官方文档的一手事实，仅取 Official Docs + 高星 OSS。下游决策：Astro SSR + D1/KV vs Hono + D1 vs Next，Lucia / better-auth / Auth.js 选型。

---

## 0. 执行摘要（30 秒结论）

**推荐栈：Astro SSR (`output: 'server'`, `@astrojs/cloudflare` 14.x + Astro 6) + Cloudflare D1（评论/用户）+ Cloudflare KV（`Astro.session` / better-auth 二级缓存）+ `better-auth`（原生 D1 驱动）**

| 决策点 | 结论 | 依据 |
|---|---|---|
| **数据库** | **D1** 为主，KV 为辅。D1 存关系型数据（user, session, account, comment），KV 存 `Astro.session` 与 rate-limit 缓存 | 官方「Choosing storage」明确分工：D1=关系型/可查询，KV=低延迟 session/config [storage-options](https://developers.cloudflare.com/workers/platform/storage-options/) |
| **鉴权库** | **`better-auth`** > Auth.js > Lucia（弃用）| `lucia` 与 `@lucia-auth/adapter-drizzle` 已在 npm 标记 deprecated（2026-08-20 核验），官推用 `better-auth`；better-auth 自 1.5 起原生 D1（Kysely 方言）且 Workers 首公民 |
| **框架形态** | **Astro SSR** 优于 Hono 纯 API 与 Next-on-Workers | Astro 6 + adapter 13+ 已用 `workerd` 统一 dev/prod，静态资源免费且 `prerender = true` 可混布；Hono 更轻但需自搭视图层；Next 需 OpenNext 转译，体积与冷启动劣化 |
| **体积/冷启动** | 三者均可 <3MB gzip（Paid 10MB）内，但 Astro 需关注 `startup_time_ms ≤1s` | Workers 限制文档 [Limits](https://developers.cloudflare.com/workers/platform/limits/) |
| **成本** | 静态资源请求免费，D1 按扫描行计费，KV 读比 D1 写便宜一个数量级 | Workers Pricing 表与 D1 Pricing 解释 |

**否定项：**
- 不要新装 `lucia` 包 —— 仅把其文档当作 session 设计课本。
- 不要在 Workers 上用 TCP 直连的 DB 客户端（如 `pg` 直连 `Prisma`）—— 必须走 HTTP/API（D1 原生、Hyperdrive、Neon HTTP）。
- 不要在 `wrangler.toml` 新项目 —— 官方自 `v3.91.0` 起推荐 `wrangler.jsonc`，部分新特性仅 JSON 可用。

---

## 1. Cloudflare Workers + D1 + KV 会话存储：最佳实践

### 1.1 官方文档入口（版本核验）

- Workers 官网：`https://developers.cloudflare.com/workers/`，索引 `https://developers.cloudflare.com/workers/llms.txt`（2026-04-23 更新）
- D1 官网：`https://developers.cloudflare.com/d1/`，索引 `https://developers.cloudflare.com/d1/llms.txt`（2026-04-30 更新）
- KV 官网：`https://developers.cloudflare.com/kv/`，索引 `https://developers.cloudflare.com/kv/llms.txt`（2026-07-31 更新）
- Wrangler 配置：`https://developers.cloudflare.com/workers/wrangler/configuration/`（2026-08-28 更新）

### 1.2 wrangler.jsonc 绑定（推荐 JSONC 而非 TOML）

Wrangler 自 `v3.91.0` 起同时支持 `wrangler.json / jsonc / toml`，官方明确推荐 `wrangler.jsonc`，且自动预配等新能力仅 JSON 可用 [Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)。

**最小可用配置（含 D1 + KV + Assets，Astro SSR 标准）：**

```jsonc
// wrangler.jsonc  — 官方示例 + Astro Cloudflare 文档综合
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "mizuki-blog",
  "main": "@astrojs/cloudflare/entrypoints/server", // Astro 6 / adapter 13+ 新入口，旧为 dist/_worker.js/index.js
  "compatibility_date": "2026-08-30",                // 设为部署当天
  "compatibility_flags": ["nodejs_compat"],           // 若 date >= 2026-08-04 可省略（默认含 v2），为兼容性保留无害
  "assets": {
    "binding": "ASSETS",
    "directory": "./dist"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mizuki-db",
      "database_id": "<UUID-from-wrangler-d1-create>",
      "migrations_dir": "migrations",
      "migrations_table": "d1_migrations"
      // "migrations_pattern": "migrations/*/migration.sql" // 仅 Drizzle 嵌套布局需要，见 1.4
    }
  ],
  "kv_namespaces": [
    { "binding": "SESSION" } // 自动预配：不填 id，wrangler deploy 时自动创建并回写
    // 若需自定义名： { "binding": "MY_SESSION", "id": "<KV_ID>" } 并在 astro.config 设 sessionKVBindingName
  ],
  "observability": { "enabled": true }
}
```

**自动预配（Beta 2025-10-24 起）：**
- 在 `d1_databases` / `kv_namespaces` 中只声明 `binding` 而不填 `id`/`database_id`，`wrangler dev` 本地自动建库、`wrangler deploy` 远端自动建库并回写 ID。Dashboard 部署不回写 repo，需到面板查询 ID [Configuration#Automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)。

**Top-level vs Non-inheritable：**
- `name/main/compatibility_date` 为最小必需；`kv_namespaces/d1_databases/vars` 为 non-inheritable，不能继承至 `env.staging`，需每环境显式声明。

### 1.3 D1 迁移（Wrangler 迁移系统）

- 单表 `d1_migrations` 记录已应用版本；文件按序号顺序执行 [Migrations](https://developers.cloudflare.com/d1/reference/migrations/)。
- 命令集 [Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)：

```bash
npx wrangler d1 create mizuki-db --binding DB        # 创建并可 --update-config 自动写入 wrangler.jsonc
npx wrangler d1 migrations create DB create_comments  # 生成 migrations/0000_create_comments.sql
npx wrangler d1 migrations list DB --local            # 查看未应用
npx wrangler d1 migrations apply DB --local           # 本地应用
npx wrangler d1 migrations apply DB --remote          # 远端应用（CI 同理）
```

- **Drizzle 嵌套布局**：`drizzle-kit generate` 默认写 `migrations/0001_init/migration.sql`，需在绑定中加：

```jsonc
{
  "d1_databases": [{
    "binding": "DB",
    "database_name": "mizuki-db",
    "database_id": "<UUID>",
    "migrations_dir": "migrations",
    "migrations_pattern": "migrations/*/migration.sql"
  }]
}
```

  规则：设 `migrations_pattern` 则必须设 `migrations_dir`，且 pattern 必须以前者为前缀 [Migrations#Nested layouts](https://developers.cloudflare.com/d1/reference/migrations/#nested-migration-layouts)。

- **外键**：迁移中若涉及破坏 FK，先 `PRAGMA defer_foreign_keys = true` [Foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)。
- **建议**：用 `wrangler d1 execute DB --local --command "SELECT name FROM sqlite_schema"` 验证；迁移失败会自动回滚到上一成功版本。

### 1.4 D1 本地预览（`wrangler dev` + Miniflare/workerd）

- `wrangler dev` 默认本地模式（Miniflare + workerd），与线上一致；数据与远端隔离 [Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)。

```bash
wrangler dev                          # 本地 D1，数据持久于 .wrangler/state
wrangler dev --persist-to=/tmp/mizuki # 团队共享持久化路径
wrangler dev --remote                 # 直连线上 DB（谨慎，不可撤销）
wrangler d1 execute mizuki-db --local --command "SELECT * FROM comment LIMIT 5"
wrangler d1 migrations apply mizuki-db --local
```

- **Pages 限制**：Pages 本地仅支持 `--local`，不支持 `--remote`。
- **测试**：可用 `Miniflare.getD1Database("DB")` 或 `unstable_dev("src/index.ts")` 编程式测试，见文档示例。

### 1.5 KV 会话存储与 Astro.session 的结合

- **官方定位**：KV = session data / credentials / config；D1 = 用户/订单等关系型数据 [Choosing storage](https://developers.cloudflare.com/workers/platform/storage-options/)。

| 维度 | KV | D1 |
|---|---|---|
| 一致性 | 最终一致，跨区传播 ≤60s | 单线程强一致（会话内顺序一致需 Sessions API） |
| 读延迟 | 热 key 通常 <10ms（边缘缓存） | 取决于距主库距离，读副本可降延迟 |
| 写限速 | 同 key 1 次/秒；账户 1000 写/天（Free） | 按行计费，需索引降扫描 |
| 适用 | session、限流计数、缓存 | 评论、用户、点赞等需 SQL 查询 |

- **Astro.session（Astro 5.7.0+）在 Cloudflare 上的实现：**
  - 适配器自动把 `SESSION` KV 绑定注入运行时；`wrangler deploy` 自动预配 [Cloudflare adapter#Sessions](https://docs.astro.build/en/guides/integrations-guide/cloudflare/#sessions)。
  - 未配置时可用 `session: false` 在 `astro.config.mjs` 关闭，以剔除会话运行时、减小 bundle（对冷启动有利）。
  - 自定义绑定名：

```js
// astro.config.mjs
import cloudflare from '@astrojs/cloudflare';
export default defineConfig({
  adapter: cloudflare({ sessionKVBindingName: 'MY_SESSION' }),
  session: { cookie: { name: 'mizuki_session', sameSite: 'lax', secure: true } },
  output: 'server',
});
```

```jsonc
// wrangler.jsonc
{ "kv_namespaces": [{ "binding": "MY_SESSION" }] }
```

  - 访问：`Astro.session.get/set`（.astro 页）、`context.session`（API/Action/Middleware，注意 edge middleware 暂不支持 session）。
  - 序列化：基于 `devalue`，支持 string/number/Date/Map/Set/URL/数组/对象；可通过 `src/env.d.ts` 的 `App.SessionData` 声明类型。

```astro
---
// src/components/CommentForm.astro
export const prerender = false;
const user = await Astro.session?.get('user'); // 类型来自 App.SessionData
---
{user ? <p>Hi {user.name}</p> : <a href="/login">Login</a>}
```

```ts
// src/pages/api/comments.ts
export async function POST(context) {
  const user = await context.session?.get('user');
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { content, postId } = await context.request.json();
  await context.locals.runtime.env.DB.prepare(
    'INSERT INTO comment (post_id, user_id, content, created_at) VALUES (?1, ?2, ?3, ?4)'
  ).bind(postId, user.id, content, Date.now()).run();
  return Response.json({ ok: true });
}
```

- **注意 60s 最终一致性**：KV 写后同区立即可读，跨区最长 60s。若博客需“发评论后立即全区可见”，评论本身放 D1（强一致），仅会话放 KV；VPN 切区用户可能短暂读到旧 session。

### 1.6 D1 查询与计费：必须建索引

- D1 按 **扫描行** 计费，非返回行数；全表扫描代价高 [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)。
- 为 `user.email`, `session.token`, `comment.post_id` 等谓词列建索引，并用 `EXPLAIN QUERY PLAN` 验 `SEARCH ... USING INDEX` 而非 `SCAN` [Use indexes](https://developers.cloudflare.com/d1/best-practices/use-indexes/)，示例：

```sql
CREATE UNIQUE INDEX idx_user_email ON user(email);
CREATE INDEX idx_session_token ON session(token);
CREATE INDEX idx_comment_post_created ON comment(post_id, created_at);
PRAGMA optimize; -- 生成统计后再跑 ANALYZE
EXPLAIN QUERY PLAN SELECT * FROM comment WHERE post_id = ? ORDER BY created_at DESC;
-- 期望： SEARCH comment USING INDEX idx_comment_post_created (post_id=?)
```

- 大表 `UPDATE/DELETE` 需分批（每批 ~1000 行），避免单语句触及付费/时长上限。

### 1.7 D1 读副本（可选）

- 默认所有查询落在主库单区；开启 `read_replication.mode = auto` 后，读可路由至就近副本，需用 `DB.withSession(bookmark)` 保证顺序一致 [Read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)。
- 评论博客若读者遍布全球，可对 `GET /api/comments?postId=` 启用会话读，写仍走主库。计费不变。

---

## 2. Workers 上可用的鉴权库：Lucia / better-auth / Auth.js

### 2.1 版本与兼容性快照（2026-08-30）

| 库 | npm 态势（2026-08-20 核验） | Workers 亲和度 | `nodejs_compat` 需求 | 备注 |
|---|---|---|---|---|
| **Lucia** (`lucia` + `@lucia-auth/adapter-drizzle`) | **已弃用**（deprecated） | 原生支持（跨 Node/Deno/Bun/Workers），但需自建表 | 不依赖（纯 Web API） | 官网已转为「实现指南」；作者 Pilcrow 建议新项目勿装包，仅读文档学 session 设计 |
| **better-auth** (`better-auth` 1.7.1 最新） | 活跃，~500k 周下载，18k+ stars | **首公民**：设计即含 Workers/Vercel Edge/Bun | 需 `nodejs_compat` **或** `nodejs_als` 以启用 `AsyncLocalStorage`（1.6+ 要求），`compatibility_date >= 2026-08-04` 可省略 | 1.5 起原生 D1（`database: env.DB`），+ Drizzle/Kysely 适配，+ `better-auth-cloudflare` 扩展 |
| **Auth.js v5** (`next-auth@beta` 5.0.0-beta.32，`next-auth` latest 仍 4.24.15) | beta 通道 | **核心兼容**，但 **DB 适配器常不兼容**（TCP） | 取决于适配器；保持 `nodejs_compat` 最稳 | 官方 Edge 文档强调：DB 适配器需拆分配置（split config）；Next 16 proxy 改 Node 后缓解，但 Workers 仍需 HTTP 驱动 |

> 来源：StarterPick 2026-05-15、PkgPulse 2026-03-09、wolf-tech 2026-06-02、better-auth 1.5 changelog、Auth.js Edge 官方页、npm registry 2026-08-20 点检。

### 2.2 Lucia：为何弃用、如何借鉴

- **弃用事实**：`lucia` 包与 Drizzle 适配在 npm 元数据已标记 deprecated；better-auth 已官宣合并 Auth.js 生态 [StarterPick] [PkgPulse]。
- **仍有价值**：其文档是最佳的「无魔法」会话教学——cookie 设置、CSRF、session 表（`user`, `session`, `account`, `verification`）设计、过期与轮转策略。
- **适用场景**：仅当你决心自研极简会话且愿意维护所有表与清理任务时，可按 Lucia 模式手写 `session` 表；否则选 better-auth/Auth.js。
- **体积**：~12KB，冷启动最快，但人力成本最高。

### 2.3 better-auth：Workers 首选（详细）

**核心优势**
- TypeScript 首公民：配置强类型、自动推断 session 类型，无需手工 module augmentation。
- 插件化：2FA/magic-link/passkey/organization/rate-limit/admin 均为官方插件。
- 适配器：Drizzle、Prisma、Kysely；Drizzle 适配支持 `joins: true`（1.4+）提升 2-3 倍查询性能。
- 安全：`scrypt` 默认哈希、`BETTER_AUTH_SECRET` 版本化轮转、Origin/Fetch-Metadata CSRF、Cookie 同站隔离，见 [Security](https://www.better-auth.com/docs/reference/security)。

**Workers / D1 接入（两条路）**

1) **原生 D1（无 Drizzle，更轻，推荐博客评论这种小表）**

```ts
// src/auth.ts  — Cloudflare Workers 运行时
import { betterAuth } from 'better-auth';
export const createAuth = (env: Env) => betterAuth({
  database: env.DB, // D1Database, 自动识别，无需适配器
  emailAndPassword: { enabled: true },
  // 建议：
  session: { expiresIn: 60*60*24*7, updateAge: 60*60*24 }, // 7d / 1d
  trustedOrigins: ['https://mizuki.example.com', 'http://localhost:8787'],
  advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
});
```

- D1 不支持交互式事务，better-auth 内部用 `batch()` 保证原子 [Better Auth D1 Support 1.5](https://better-auth.com/blog/1-5)。
- 迁移：CLI 无法直连远端 D1，需编程式 `getMigrations` 通过 Worker 端点执行（仅 Kysely 内置适配支持，Drizzle/Prisma 用 CLI 文件）。

2) **Drizzle 适配（需类型与迁移工具链，适合已用 Drizzle 的项目）**

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/d1';
import { env } from 'cloudflare:workers';
import * as schema from './schema';

const db = drizzle(env.DB, { schema });
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'sqlite', usePlural: true }),
});
```

**Cloudflare 专属增强：`better-auth-cloudflare`（zpg6, 460 snippets, 89.77 分）**

- 在原生 better-auth 上叠加 `withCloudflare({ d1, kv, r2, geolocationTracking, autoDetectIpAddress })`，可：
  - 用 KV 做二级缓存/限流（`rateLimit: { window: 60, max: 100, customRules: { "/sign-in/email": { window: 60, max: 20 } } }` 注意 KV TTL 最小 60s）
  - R2 存用户上传
  - 地理位置/ IP 自动注入客户端插件
  - CLI `npx better-auth-cloudflare generate/migrate` 一键建 D1/KV/R2

```ts
import { betterAuth } from 'better-auth';
import { withCloudflare } from 'better-auth-cloudflare';
export const auth = betterAuth({
  ...withCloudflare(
    { d1: { db, options: { usePlural: true } }, kv: env.KV, cf: request.cf, geolocationTracking: true },
    { emailAndPassword: { enabled: true }, rateLimit: { enabled: true, window: 60, max: 100 } }
  ),
});
```

**`nodejs_compat` 要求**
- better-auth 依赖 `AsyncLocalStorage` 做异步上下文；官方安装页要求 `compatibility_flags = ["nodejs_compat"]` 或 `["nodejs_als"]` （date 2024-09-23+）。自 `2026-08-04` 起 Workers 已默认启用，`compatibility_date` ≥ 该日可省略，但为保险保留无害 [better-auth Installation] [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)。

**在 Astro 上的接入**

```ts
// src/pages/api/auth/[...auth].ts
import { createAuth } from '../../auth';
export const prerender = false;
export async function ALL(context) {
  const auth = createAuth(context.locals.runtime.env);
  return auth.handler(context.request);
}
```

```jsonc
// 需要 nodejs_compat 时的 wrangler.jsonc
{ "compatibility_date": "2026-08-30", "compatibility_flags": ["nodejs_compat"] }
```

### 2.4 Auth.js / NextAuth：兼容性陷阱与解法

- **陷阱**：Auth.js 核心可在任意 JS 运行时跑，但常用 DB 客户端走 **TCP sockets**（Postgres/MySQL 协议），而 Edge/Workers 运行时缺该能力。后果是 `auth()` 在 edge middleware/proxy 中调 DB 会直接失败 [Edge Compatibility](https://authjs.dev/guides/edge-compatibility)。
- **官方解法 — Split Config**：

```ts
// auth.config.ts  — 无适配器，供 edge 使用
import GitHub from 'next-auth/providers/github';
import type { NextAuthConfig } from 'next-auth';
export default { providers: [GitHub] } satisfies NextAuthConfig;

// auth.ts — 仅 Node/SSR 侧使用，含适配器与 jwt 策略
import NextAuth from 'next-auth';
import authConfig from './auth.config';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from './db';
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: { strategy: 'jwt' },
  ...authConfig,
});

// proxy.ts（Next 16）/ middleware.ts（旧）
import NextAuth from 'next-auth';
import authConfig from './auth.config';
export const { auth: proxy } = NextAuth(authConfig); // 此处无 DB 调用
```

- **对 Workers 的启示**：
  - 若坚持 Auth.js，必须选 **HTTP 驱动** 的 DB 客户端：`@cloudflare/workers-types` 的 `D1Database`、`@auth/drizzle-adapter` 配 D1、`@auth/prisma-adapter` 仅当配 Hyperdrive/Prisma Data Proxy；直连 `pg` 将不可用。
  - 需在 Workers 制品中用 `nodejs_compat` 垫 `Buffer/crypto` 等。
  - 与 Astro 集成需经 `auth-astro`（482 snippets）或手写 `APIContext`，不如 better-auth 原生。

- **版本风险**：`5.0.0-beta.32` 仍在 beta 通道，`latest` 为 `4.24.15`。若团队已有 NextAuth 存量，留在 v4 并用 `jwt` 策略规避 DB 边端问题；新站不推荐以它首发上 Workers。

### 2.5 三者体积、冷启动、功能对比

| 维度 | Lucia（自研） | better-auth | Auth.js v5 |
|---|---|---|---|
| 包体积（核心） | ~12KB | ~45KB（`better-auth/minimal` 可剪枝） | ~25KB core + 适配器 |
| Workers 冷启动 | 最快（无依赖） | 快（需 ALS，`nodejs_compat` 内置） | 中（拆分配置增加分支） |
| DB 适配 | 自写 SQL | 原生 D1 / Drizzle / Prisma / Kysely | 多适配但需 HTTP 兼容 |
| 功能完整度 | 仅 session 原语，OAuth/2FA/组织需自研 | 开箱含 Email+Password/OAuth/2FA/Passkey/Organization/RateLimit | Auth 完整，但组织/2FA/passkey 需外拼或自研 |
| 类型体验 | 需自定 | 最佳（推断会话类型） | 良（需 augmentation） |
| 维护态势 | 弃用，文档留存 | 高频（周 3 版） | 中高频但 v5 仍 beta |
| 适用 | 学习/极定制 | **新博客首选** | 存量 Next 项目 |

**结论：** 动态 Mizuki 需「登录 + 评论 + 点赞」且要最少维护，**better-auth 原生 D1** 是唯一同时满足「Workers 体积限制、官方推荐、插件完备」的选择；Lucia 仅作参考，Auth.js 作为次选且需承担 TCP/边端适配成本。

---

## 3. Astro SSR 在 Workers 上的动态模式（@astrojs/cloudflare adapter 4.x）

### 3.1 版本与定位核验

- **当前稳定**：`@astrojs/cloudflare` `v14.2.5`（2026-08-12 文档），要求 Astro 6 時 ≥ `v13`。
- **职责**：把按需渲染路由、Server Islands、Actions、Sessions 编译为 Worker；纯静态站无需适配器 [Cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)。
- **Vite 集成**：底层复用 `@cloudflare/vite-plugin`，开发期即跑 `workerd`，与线上一致（不再是 Node 模拟）。

### 3.2 动态模式：`output: 'server'` 与按页回退

- `output: 'server'` = 全站按需渲染（SSR）；个别页 `export const prerender = true` 可静态化（如 `/privacy`、文章详情若走 SSG + 评论走岛）。
- 默认即静态（无 adapter 时）；加 adapter 后可单页 `export const prerender = false` 或全站 `output: 'server'` [On-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)。
- **推荐博客策略**：`output: 'server'` + 将内容页保持 `prerender = false`，但用 **Server Islands** 或 **Route caching** 缓页面壳，评论/会话走动态岛，避免全站静态重建。

```js
// astro.config.mjs  — 最小动态配置
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    imageService: 'cloudflare',               // 或 'cloudflare-binding'（需 IMAGES 绑定）
    sessionKVBindingName: 'SESSION',          // 可省，默认即 SESSION
    prerenderEnvironment: 'workerd',          // 默认 workerd；若 prerender 页用 node:fs 则切 'node'
  }),
  session: { cookie: 'mizuki_session' },     // 可为 string 或 { name, sameSite, secure }
});
```

### 3.3 Cloudflare 运行时 API

- **环境变量/绑定**：`import { env } from 'cloudflare:workers'` 读 `vars/d1/kv/r2`；兼容 `astro:env`。
- **Geolocation**：`Astro.request.cf` 取 `country/city`。
- **执行上下文**：`Astro.locals.cfContext.waitUntil()` 延后任务（发评论后异步写审核队列）；`ctx.exports` 调 Durable Objects。
- **类型**：`wrangler types` 生成 `Env`，建议 `package.json` 加 `wrangler types && astro check` 前置。

### 3.4 Sessions 与 Cookies API

- **Cookies**：`Astro.cookies.get/set/has/delete`；`Astro.response.headers` 设缓存头；可 `return new Response` / `Astro.redirect` [Sessions] [On-demand rendering#Cookies]。
- **Session 驱动**：Cloudflare 适配自动配 KV；`session: false` 可在 `astro.config` 关闭以减 bundle（serverless/edge 推荐按需关闭）。
- **中间件**：`context.session` 在中间件可用，但文档注明 **edge middleware 暂不支持 session**，需在页面/API 层校验。
- **本地预览**：`astro dev` 已切 `workerd`，`astro preview` 受支持；Wrangler 配置文件现可选（无 wrangler.jsonc 也可起）。

### 3.5 升级到 Astro 6 / adapter 13 的破坏性变更

- `astro dev` / `preview` 改跑 `workerd` 而非 Node；`prerenderEnvironment` 新增控制构建期运行环境。
- `main` 指向 `@astrojs/cloudflare/entrypoints/server`（取代 `dist/_worker.js/index.js`）。
- `Astro.locals.runtime` 移除，改用 `cloudflare:workers` 的 `env`。
- `wrangler` 配置可选，新增 `astro preview` 支持。
- `imageService` 默认改 `cloudflare-binding`。

> 实操：若遇到 `Could not resolve "node:fs" ... The package wasn't found`，说明你在 SSR 页直接引了 Node API，需加 `nodejs_compat` 或将该页 `prerenderEnvironment: 'node'`/移到 prerender。

### 3.6 高级路由（可选）

- 适配器提供伴生处理器，注入 `SESSION` 绑定、`ASSETS`、静态资源路由；在 `advanced` 模式可配合 `Fetch API` / `Hono` 自定义路由 [Cloudflare adapter#Advanced routing]。Mizuki 若需 `/api/*` 与页面混布，可保持默认，无需 Hono；若 API 复杂再引入 `astro/hono` 模块。

---

## 4. 体积限制、冷启动、成本横向对比（含最小可用配置）

### 4.1 硬限制（Workers Platform Limits 2026-07-28）

| 指标 | Free | Paid | 对博客的影响 |
|---|---|---|---|
| **Worker 大小（gzip）** | 3 MB | 10 MB | Astro SSR 全量约 0.8-2.2MB gzip（含 islands），Hono + better-auth ~0.3-0.6MB，Next (OpenNext) 常 >2.5MB 易触限 |
| **启动时间** | 1s（硬） | 1s | `startup_time_ms` 在 `wrangler deploy` 输出；超限报 `10021`，需下沉初始化至 handler |
| **内存** | 128 MB / isolate | 128 MB | 单 isolate 复用多请求，超限会切新 isolate |
| **CPU 时间** | 10ms / 请求 | 30s 默认，可提至 5min | 鉴权/渲染属 10-20ms 档，安全阈内 |
| **子请求** | 50/请求 | 10k/请求（可提至 10M） | D1/KV/R2/fetch 均算子请求，评论链路 <10 次足够 |
| **并发连接** | 6 等 header 阶段 | 6 | 同 invocation 内并行 fetch 需控制 |
| **KV 单操作限** | 1000/ invocation | 1000 | 读多写少足够 |
| **D1 查询** | 50/ invocation | 1000 | 读多写少，batch 合并 |

- **检测体积**：`npx wrangler deploy --dry-run --outdir dist` 看 `Total Upload: xx KiB / gzip: yy KiB` [Bundling](https://developers.cloudflare.com/workers/wrangler/bundling/)。
- **诊断**：Wrangler 超 `startup` 限会自动产 CPU profile，可导 Chrome DevTools 分析。

### 4.2 冷启动与运行时

- Workers 基于 **Isolate（V8）** 而非容器，冷启动常在 **数毫秒至百毫秒** 级，远快于传统 Node SSR；`workerd` 的 `nodejs_compat_v2` 已把 `node:buffer/crypto/path` 等内建，无需 polyfill 膨胀。
- Astro SSR 在 Workers 上的冷启动主要受 **bundle 体积 + 全局初始化** 影响：
  - 优化：把大 schema/配置移入 handler、启用 `session: false`（若无会话）、拆 `assets` 走静态资源（Worker 不执行）。
  - Hono 因无视图编译，启动略快；但 Astro 的 `prerenderEnvironment: 'workerd'` 使 dev 与 prod 一致，线上抖动更小。

### 4.3 成本模型（Workers Standard）

| 资源 | 计费要点 | 博客估算 |
|---|---|---|
| **Workers 请求** | $5/月含 10M 请求，超 $0.30/百万；静态资源请求 **免费无限** | 若 80% 命中静态（如文章壳缓存），15M/月可仅 $5 |
| **CPU** | 30M ms/月含，超 $0.02/百万 ms | 平均 7ms/请求 × 15M = 105M ms → $1.5（上例） |
| **D1** | 按行计费：5B 读/50M 写每季？ Paid：前 25B 读/50M 写含，超 $0.001/百万读、$1/百万写；**关键：扫描行而非返回行** | 无索引的 `SELECT * FROM comment WHERE post_id=?` 若全表 50k 行，每次扫 50k；索引后仅扫匹配行（如 20） |
| **KV** | Paid：10M 读/1M 写/删含，超 $0.50/$5.00/百万；1GB 存储含 | 会话读为高频，用 KV 比 D1 写便宜且延迟更低；需容忍 60s 最终一致 |
| **R2** | 10GB 存储/1M A 类/10M B 类含，出口免费 | 评论头像/附件可走 R2，成本可忽略 |

- **省钱要点**：文章页 `prerender + stale-while-revalidate` 或 `Astro.response.headers.set('Cache-Control', 'public, max-age=3600')`，把正文壳缓存至边缘，仅评论/会话动态；为 D1 高频读加索引，关注 `meta.rows_read / rows_written`。

### 4.4 三种动态栈的最小可用配置对比

#### A. Astro SSR + D1（原生）+ KV + better-auth — **推荐**

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  session: { cookie: { name: 'mizuki_sess', sameSite: 'lax', secure: true } },
});
```
```jsonc
// wrangler.jsonc
{
  "name": "mizuki-blog",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-08-30",
  "assets": { "binding": "ASSETS", "directory": "./dist" },
  "d1_databases": [{ "binding": "DB", "database_name": "mizuki-db", "database_id": "<UUID>" }],
  "kv_namespaces": [{ "binding": "SESSION" }]
}
```
```ts
// src/auth.ts
import { betterAuth } from 'better-auth';
export const auth = (env: Env) => betterAuth({ database: env.DB, emailAndPassword: { enabled: true } });
```
- **优**：单 Worker、全栈同构、`Astro.session` + `auth` 复用同 KV、静态资源自动边缘缓存、类型完备。
- **劣**：bundle 略大于纯 Hono，但仍远低于限值；KV 最终一致需接受。

#### B. Hono + D1 + KV（Astro 仅静态壳，API 单独 Worker）— **备选（追求最小 bundle）**

```ts
// api/src/index.ts
import { Hono } from 'hono';
import { betterAuth } from 'better-auth';
import { withCloudflare } from 'better-auth-cloudflare';
import { drizzle } from 'drizzle-orm/d1';
const app = new Hono<{ Bindings: Env }>();
app.all('/api/auth/*', async (c) => {
  const auth = betterAuth({
    ...withCloudflare(
      { d1: { db: drizzle(c.env.DB), options: { usePlural: true } }, kv: c.env.KV, cf: c.req.raw.cf },
      { emailAndPassword: { enabled: true } }
    )
  });
  return auth.handler(c.req.raw);
});
export default app;
```
```jsonc
// wrangler.jsonc（独立 api worker）
{ "name": "mizuki-api", "main": "src/index.ts", "d1_databases": [{ "binding": "DB", "database_name": "mizuki-db", "database_id": "<UUID>" }], "kv_namespaces": [{ "binding": "KV" }] }
```
- **优**：API Worker 体积最小（Hono ~14KB），冷启动最快；可独立扩容、与 Astro 静态壳解耦。
- **劣**：两 Worker 间需处理 CORS/同域 cookie（`crossSubDomainCookies` 或同域路由绑定）、多一份部署与类型同步。

#### C. Next.js / Next+Vinext on Workers（OpenNext）— **不推荐**

- 需 `@opennextjs/cloudflare` 转译，`next.config` 复杂，`next-auth` v5 仍 beta 且需 split config；bundle 常 >3MB gzip，`startup_time_ms` 易超 1s；静态资源不再享受 Astro 的「请求免费」优化路径。
- 仅当团队已重度 Next 且愿承担适配成本时考虑；新博客直接排除。

---

## 5. 取舍结论与落地清单（供 Plan 直接引用）

### 5.1 最终取舍

- **DB**：D1 为主，必要时加 KV 二级；不要把会话硬塞进 D1 每次查 `session` 表（高频读放大），也不要把评论硬塞 KV（需查询能力）。
- **Auth**：`better-auth` 原生 D1 + 可选 `better-auth-cloudflare`（KV 限流 + R2 + 地理）；Lucia 仅作学习，Auth.js 仅在存量 Next 场景保留。
- **框架**：Astro SSR `output: 'server'` + `prerender` 回退 + Server Islands 承载评论框与登录态；若未来 API 爆炸，再把 `/api/*` 抽至 Hono 子 Worker，Astro 壳通过 `ASSETS` + `service bindings` 调用。

### 5.2 最小落地步骤（按依赖序）

1. `pnpm dlx create-cloudflare@latest mizuki-blog --framework=astro` 或 `npm create astro@latest -- --template minimal` + `npx astro add cloudflare`
2. `npx wrangler d1 create mizuki-db --update-config`，在 `wrangler.jsonc` 确认 `migrations_dir`
3. `npx wrangler d1 migrations create DB init` 写入：

```sql
-- migrations/0001_init.sql
CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, emailVerified INTEGER, name TEXT, image TEXT, createdAt INTEGER, updatedAt INTEGER);
CREATE TABLE session (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id), token TEXT UNIQUE NOT NULL, expiresAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, createdAt INTEGER, updatedAt INTEGER);
CREATE TABLE account (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id), providerId TEXT NOT NULL, accountId TEXT NOT NULL, accessToken TEXT, refreshToken TEXT, idToken TEXT, expiresAt INTEGER, createdAt INTEGER, updatedAt INTEGER);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER);
CREATE TABLE comment (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id), content TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX idx_user_email ON user(email);
CREATE INDEX idx_session_token ON session(token);
CREATE INDEX idx_comment_post_created ON comment(post_id, created_at);
PRAGMA optimize;
```

4. 本地：`npx wrangler d1 migrations apply DB --local && pnpm dev`（会自动走 `workerd`）
5. 上线：`npx wrangler d1 migrations apply DB --remote && pnpm build && npx wrangler deploy`

### 5.3 关键开关备忘

- `compatibility_date >= 2026-08-04` 时 `nodejs_compat`/`v2` 默认开，无需显式；若团队要显式兼容旧日期，保留 `"compatibility_flags": ["nodejs_compat"]`。
- KV 限流窗口 `window` 最小 60（KV TTL 限制）；评论防刷建议 D1 `comment` 表加 `UNIQUE(post_id, user_id, created_at)` 或 Hono 层 `rateLimit: { window: 60, max: 5 }` for `/api/comments`。
- `wrangler types` 每改 `wrangler.jsonc` 后必跑，保证 `Env.DB: D1Database` 类型正确。

### 5.4 何时切换到 Hono

- 当 `wrangler deploy --dry-run` 显示 `gzip > 2MB` 或 `startup_time_ms > 700ms`，或评论/搜索等 API 需独立限流/队列时，再将 `/api/*` 抽为 Hono Worker，原 Astro 壳通过 `routes` 或 `service bindings` 代理。

---

## 6. 来源索引（官方 + 高星，2025-2026）

| 主题 | 文档/仓库 | 更新/核验 |
|---|---|---|
| Workers 概览与 llms.txt 索引 | https://developers.cloudflare.com/workers/ / https://developers.cloudflare.com/workers/llms.txt | 2026-04-23 |
| D1 概览与 llms | https://developers.cloudflare.com/d1/ / https://developers.cloudflare.com/d1/llms.txt | 2026-04-30 |
| KV 概览与 llms | https://developers.cloudflare.com/kv/ / https://developers.cloudflare.com/kv/llms.txt | 2026-07-31 |
| Choosing storage (D1 vs KV) | https://developers.cloudflare.com/workers/platform/storage-options/ | 2026-04-23 |
| Wrangler Configuration（含 jsonc 推荐、自动预配） | https://developers.cloudflare.com/workers/wrangler/configuration/ | 2026-08-28 |
| D1 Wrangler commands | https://developers.cloudflare.com/d1/wrangler-commands/ | 2026-04-21 |
| D1 Migrations | https://developers.cloudflare.com/d1/reference/migrations/ | 2026-06-08 |
| D1 Local development | https://developers.cloudflare.com/d1/best-practices/local-development/ | 2026-06-25 |
| KV Limits | https://developers.cloudflare.com/kv/platform/limits/ | 2026-04-21 |
| D1 Limits | https://developers.cloudflare.com/d1/platform/limits/ | 2026-04-21 |
| Workers Limits（含 3/10MB、1s startup、128MB） | https://developers.cloudflare.com/workers/platform/limits/ | 2026-07-28 |
| Workers Pricing（静态资源免费） | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-08-28 |
| Node.js compatibility（含 2026-08-04 默认 nodejs_compat） | https://developers.cloudflare.com/workers/runtime-apis/nodejs/ | 2026-08-12 |
| Workers Bundling | https://developers.cloudflare.com/workers/wrangler/bundling/ | 2026-04-23 |
| Vite Plugin (workerd) | https://developers.cloudflare.com/workers/vite-plugin/ | 2026-07-03 |
| D1 Read Replication / Sessions API | https://developers.cloudflare.com/d1/best-practices/read-replication/ | 2026-08-10 |
| D1 Use indexes（含 EXPLAIN、rows_read 计费） | https://developers.cloudflare.com/d1/best-practices/use-indexes/ | 2026-08-10 |
| Astro Cloudflare Adapter 14.2.5 | https://docs.astro.build/en/guides/integrations-guide/cloudflare/ | 2026-08-12 文档 |
| Astro Sessions | https://docs.astro.build/en/guides/sessions/ | 2026（5.7.0+） |
| Astro On-demand rendering | https://docs.astro.build/en/guides/on-demand-rendering/ | 2026 |
| Auth.js Edge Compatibility（DB 适配器 TCP 陷阱、split config） | https://authjs.dev/guides/edge-compatibility | 2026 官网 |
| better-auth D1 Support 1.5 | https://better-auth.com/blog/1-5 | 2026-02-28 |
| better-auth Drizzle Adapter | https://www.better-auth.com/docs/adapters/drizzle | 2026 |
| better-auth Security（scrypt、secret 轮转、CSRF） | https://www.better-auth.com/docs/reference/security | 2026 |
| better-auth-cloudflare（zpg6, 460 snippets） | https://github.com/zpg6/better-auth-cloudflare | 2025-05-07, 高星 |
| StarterPick: Auth.js vs Lucia vs better-auth（npm 点检 2026-08-20） | https://starterpick.com/guides/authjs-v5-vs-lucia-v3-vs-better-auth-2026 | 2026-05-15 |
| PkgPulse: better-auth vs Lucia vs NextAuth | https://www.pkgpulse.com/guides/better-auth-vs-lucia-vs-nextauth-2026 | 2026-03-09 |
| wolf-tech: Auth frameworks 2025/2026 | https://wolf-tech.io/blog/nextjs-authentication-frameworks-2025-2026-authjs-v5-clerk-better-auth-lucia-b2b-saas | 2026-06-02 |

> 本文件已同步至：`/home/sanjiu/jiuyue/docs/research/2026-08-30-cloudflare-workers-dynamic-blog-auth-db.md`（镜像于 `/.omo/research/` 可检索）。

