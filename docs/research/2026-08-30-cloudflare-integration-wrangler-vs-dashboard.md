# Cloudflare 官方集成调研：Workers + D1 + KV + R2 + Astro（wrangler.jsonc vs Dashboard）

> 调研时间：2026-08-30 · 目标：Mizuki 博客 `Astro 7 + Workers + D1 + KV (+R2) + better-auth` 的官方推荐集成路径
> 官方一手来源：`developers.cloudflare.com` 最新版本（2026-08-28 / 2026-08-12 / 2026-08-21 等），不依赖二手博客

---

## 1. wrangler.jsonc 绑定配置（d1_databases / kv_namespaces / r2_buckets / vars）

### 1.1 官方声明：JSON 是首选

- **自 Wrangler v3.91.0 同时支持 `wrangler.json`/`wrangler.jsonc` 和 `wrangler.toml`，此前仅支持 TOML**。Cloudflare 明确：「**推荐新项目使用 `wrangler.jsonc`，部分新特性仅对 JSON 配置开放**」。
- 两种格式语义完全一致，仅语法不同。
- 官方示例与最新 Astro 指南（2026-08-12）全部以 `wrangler.jsonc` 为主示例。

> 来源：[Configuration — Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/)（Last updated Aug 28, 2026） — 开头 Note 段落

### 1.2 三类关键 Key 的分类（决定能否按环境覆盖）

| 类别 | Key | 说明 |
|------|-----|------|
| **Top-level only** | `keep_vars`, `send_metrics` | 只允许出现在顶层，不能放在 `env.*` 内 |
| **Inheritable** | `name`, `main`, `compatibility_date`, `compatibility_flags`, `assets`, `observability`, `routes` | 顶层定义后可被环境继承/覆盖 |
| **Non-inheritable** | `vars`, `d1_databases`, `kv_namespaces`, `r2_buckets`, `secrets`, `durable_objects`, `queues` 等全部 bindings | **必须在每个环境中显式重复定义，不会自动继承** |

> 来源：同一配置页 `#top-level-only-keys` / `#inheritable-keys` / `#non-inheritable-keys` 三节

**对 Mizuki 的意义**：若未来使用 `env.staging` / `env.production`，`DB` 和 `SESSION` 必须各自重写一遍，不能指望继承顶层。

### 1.3 各绑定最小形态

#### D1

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",               // Worker 内 env.DB
      "database_name": "mizuki-db",  // 人类可读名，不可变
      "database_id": "<UUID>",       // wrangler d1 create / d1 list 返回
      "preview_database_id": "<UUID>", // 可选，wrangler dev --remote 时用
      "migrations_dir": "migrations", // 可选，默认 migrations/
      "migrations_table": "d1_migrations", // 可选
      "migrations_pattern": "migrations/*.sql" // 可选，Drizzle 嵌套布局需设置
    }
  ]
}
```

> 来源：[Configuration — D1 databases](https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases) + [D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)（2026-06-08）

额外细节：
- `preview_database_id` 建议配置，用于 `wrangler dev --remote` 时隔离生产库。
- `migrations_dir` / `migrations_pattern` 必须配合：当 `migrations_pattern` 设置时必须同时设置 `migrations_dir`，且 pattern 必须以 `migrations_dir` 为前缀。Drizzle 典型值 `migrations/*/migration.sql` 或 `migrations/**/*.sql`。

#### KV

```jsonc
{
  "kv_namespaces": [
    { "binding": "SESSION", "id": "<KV_ID>", "preview_id": "<PREVIEW_KV_ID>" }
  ]
}
```

> 来源：[Configuration — KV namespaces](https://developers.cloudflare.com/workers/wrangler/configuration/#kv-namespaces)
> Astro 2026-08-12 指南特别说明：**Astro Session API 自动使用 KV，Wrangler 会在 deploy 时自动创建名为 `SESSION` 的 namespace，无需手动创建**。可通过 `sessionKVBindingName` 适配器选项自定义绑定名。

#### R2

```jsonc
{
  "r2_buckets": [
    { "binding": "MY_BUCKET", "bucket_name": "my-bucket" }
  ]
}
```

> 来源：[Configuration — R2 buckets](https://developers.cloudflare.com/workers/wrangler/configuration/#r2-buckets) + [Bindings (env)](https://developers.cloudflare.com/workers/runtime-apis/bindings/)

#### vars（明文环境变量）与 secrets 的分工

```jsonc
{
  "vars": {
    "API_HOST": "example.com",           // 明文，可提交（非敏感）
    "SERVICE_X_DATA": { "URL": "...", "MY_ID": 123 } // JSON 值也支持
  },
  "secrets": {
    "required": ["BETTER_AUTH_SECRET", "GITHUB_CLIENT_SECRET"] // 仅声明，不存值；用于本地校验+类型生成
  }
}
```

- `vars` 是 binding，会注入 `env.API_HOST`，同样可通过 `import { env } from "cloudflare:workers"` 在全局访问，或在 `nodejs_compat` 下通过 `process.env` 访问。
- **禁止把 Secret 写进 `vars`**。Secret 必须通过 `wrangler secret put <KEY>` 或 Dashboard `Secret` 类型添加；本地则放在 `.dev.vars` / `.env`（均需 `.gitignore`）。
- `.dev.vars` 与 `.env` 二选一：若存在 `.dev.vars` 则忽略 `.env`；`.dev.vars.<env>` 时仅加载该环境文件；`.env` 则按 `.env.<env>.local > .env.local > .env.<env> > .env` 合并。

> 来源：
> - [Environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)（2026-08-21）
> - [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)（2026-07-03）
> - [Configuration — Secrets configuration property](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets)

### 1.4 自动供应（Automatic provisioning，Beta 2025-10-24）

只需写 `binding` 不写 `id`/`bucket_name`，`wrangler dev` 会本地创建，`wrangler deploy` 会远端创建并**回写 ID 到配置文件**。支持的资源：KV、R2、D1、Queues 等。若通过 Dashboard/GitHub 部署时以此方式创建，ID 仅能在 Dashboard 看到，不会回写到仓库。

> 来源：[Configuration — Automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning) + Changelog 2025-10-24

---

## 2. D1 的 Wrangler 命令与迁移（本地 / 远端）

### 2.1 核心命令（全部以 REST control-plane 为后端）

| 命令 | 作用 | 关键 flag |
|------|------|-----------|
| `wrangler d1 create [NAME]` | 创建库，返回 `database_id` | `--binding`, `--location weur/eeur/apac/...`, `--jurisdiction eu/us/fedramp`, `--update-config --binding <B>` 可直接写回配置 |
| `wrangler d1 list` | 列出账户下所有 D1 | `--json` |
| `wrangler d1 info [NAME]` | 查大小/状态 | |
| `wrangler d1 execute [DB] --command "SELECT ..."` | 执行 SQL | `--local` 本地 Miniflare 模拟；`--remote` 远端生产库；`--preview` 预览库；`--file ./foo.sql` |
| `wrangler d1 export [NAME] --output dump.sql` | 导出 schema/data | `--local/--remote`, `--no-schema`, `--no-data`, `--table` |
| `wrangler d1 migrations create [DB] [MESSAGE]` | 生成 `migrations/0000_<message>.sql` | |
| `wrangler d1 migrations list [DB]` | 列未应用的迁移 | `--local/--remote/--preview` |
| `wrangler d1 migrations apply [DB]` | 按序应用未应用的迁移，自动备份，失败回滚 | `--local/--remote/--preview` |
| `wrangler d1 time-travel info/restore` | 30 天内时间旅行 | `--timestamp` / `--bookmark` |

> 来源：[D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)（Last updated Apr 21, 2026）全文

### 2.2 本地 vs 远端的行为分野

- **默认 `wrangler dev` / `vite dev` = 全部绑定本地模拟**（Miniflare + workerd，`TZ=UTC`）。D1 文件落在 `.wrangler/state` 等本地持久化目录，可通过 `--persist-to <dir>` 自定义路径。
- **`wrangler d1 execute --local` / `migrations apply --local`** 操作的是本地模拟 D1；`--remote` 则直连生产 D1；`--preview` 操作预览库。
- **Remote bindings**：可在 `wrangler.jsonc` 中为单类绑定加 `"remote": true`，让 `wrangler dev` 时该绑定直连远端资源（代码仍在本地跑）。但 **D1/KV/R2 均支持 `remote: true`**，而 `vars`/`secrets`/`assets` 永远不支持远程（变量本就应在本地用 `.dev.vars` 区分）。
- **`wrangler dev --remote`（Legacy）**：整个 Worker 上传到 Cloudflare 临时预览环境，所有绑定强制远端，迭代慢，不被 Vite 插件支持。官方推荐「本地 dev + 按需 remote bindings」而非全远程。

> 来源：
> - [Local development](https://developers.cloudflare.com/workers/local-development/)（2026-08-20）— Bindings during local development / Remote bindings 章节
> - [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/) 中各命令的 `--local/--remote/--preview` 定义

### 2.3 迁移系统细节（Migrations）

- 迁移文件是顶层 `migrations/*.sql`，文件名含版本号，执行顺序按文件名排序，执行记录写入库内 `d1_migrations` 表。
- `migrations_dir` / `migrations_pattern` 可定制（如 Drizzle 的 `migrations/*/migration.sql`），此时 `wrangler d1 migrations create` 仍只生成顶层文件，应改用 `drizzle-kit generate` 生成。
- 执行时可用 `binding` 名或 `database_name`，但 **推荐用 `database_name`**（binding 可变，库名不可变，避免误操作）。
- `apply` 会先备份，CI 非交互环境自动跳过确认。

> 来源：[D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)（2026-06-08）+ Configuration D1 章节

### 2.4 Mizuki 当前脚本与官方一致性

`package.json` 已符合官方推荐：

```json
"db:generate": "drizzle-kit generate",
"db:migrate:local": "wrangler d1 migrations apply DB --local",
"db:migrate:remote": "wrangler d1 migrations apply DB --remote"
```

均使用 `--local` / `--remote` 区分，符合 2026 文档。建议补充 `wrangler d1 migrations create DB <msg>` 到文档，但 Drizzle 项目更推荐 `drizzle-kit generate` + 配置 `migrations_pattern`。

---

## 3. Astro 框架指南（Workers + Workers Assets）

> 来源：[Astro — Cloudflare Workers Framework Guide](https://developers.cloudflare.com/workers/frameworks/framework-guides/astro/)（Last updated Aug 12, 2026）

### 3.1 两种创建路径

1. **C3 脚手架**：`npm create cloudflare@latest -- my-astro-app --framework=astro` — 自动生成项目、安装 `@astrojs/cloudflare`、可选立即部署。
2. **存量 Astro 项目自动配置**：在无 `wrangler.jsonc` 的项目中直接 `npx wrangler deploy`，Wrangler 会自动检测 Astro 并生成配置（`main: dist/_worker.js/index.js`, `assets: { directory: ./dist, binding: ASSETS }`, `compatibility_flags: nodejs_compat`, `observability: enabled: true`, `adapter: @astrojs/cloudflare`）。

### 3.2 手动配置（官方推荐的最小配置）

**纯静态站**（无 SSR）：

```jsonc
{
  "name": "my-astro-app",
  "compatibility_date": "2026-08-28",
  "assets": { "directory": "./dist" }
}
```
无 `main` 字段，纯资产托管。

**SSR / on-demand rendering**（Mizuki 属于此类，`output: "server"`）：

```jsonc
{
  "name": "my-astro-app",
  "main": "./dist/_worker.js/index.js",
  "compatibility_date": "2026-08-28",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "binding": "ASSETS", "directory": "./dist" },
  "observability": { "enabled": true }
}
```

并需：

1. `npx astro add cloudflare`（自动改 `astro.config.mjs` 为 `output: "server"` + `adapter: cloudflare()`）；
2. 在 `public/` 下创建 `.assetsignore` 写入：
   ```
   _worker.js
   _routes.json
   ```
   避免资源被当成静态资产重复上传。

> Mizuki 当前 `astro.config.mjs` 已正确：`output: "server"` + `adapter: cloudflare()`，`tailwindcss` 通过 Vite 插件接入，符合 Astro 7 要求（Node >=22.12.0）。

### 3.3 Bindings 与 Astro 的衔接

- **纯静态站不能使用 bindings**。
- SSR 站可通过 `locals` 访问 `env`（如 `Astro.locals.runtime.env.DB` 或 `context.locals.runtime.env`，取决于适配器版本），官方 Astro 集成文档指向 `https://docs.astro.build/en/guides/integrations-guide/cloudflare/#cloudflare-runtime`。
- **Sessions**：Astro Sessions API 在 Cloudflare 适配器下**自动配置 KV**，Wrangler deploy 时自动供应名为 `SESSION` 的 KV，无需手动创建。可通过适配器选项 `sessionKVBindingName` 自定义绑定名。

### 3.4 Node 要求

- Astro 5.x：Node 18.20.8 / 20.3.0+ / 22.0.0+
- **Astro 6.x / 7.x：Node 22.12.0+**（Mizuki `engines.node >=22.12.0` 已对齐；Workers Builds 默认版本满足，若覆盖需选对应版本）

### 3.5 部署与路由

- 支持 `*.workers.dev` 或 Custom Domain / Routes，`wrangler deploy` 或 Workers Builds 均可。
- `not_found_handling: "404-page"` 可为 Astro 的 `src/pages/404.astro` 提供自定义 404：

```jsonc
{ "assets": { "directory": "./dist", "not_found_handling": "404-page" } }
```

---

## 4. Dashboard vs wrangler.jsonc：优先级与覆盖规则（以哪个为准）

> 核心来源：[Configuration — Source of truth](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth) + [Configuration — Top-level only keys / keep_vars](https://developers.cloudflare.com/workers/wrangler/configuration/#top-level-only-keys) + GitHub 同步讨论

### 4.1 官方定调：**wrangler.jsonc 是 Source of Truth**

原文（2026-08-28 版本）：

> *We recommend treating your Wrangler configuration file as the source of truth for your Worker configuration, and to avoid making changes to your Worker via the Cloudflare dashboard if you are using Wrangler.*
>
> *If you need to make changes to your Worker from the Cloudflare dashboard, the dashboard will generate a TOML snippet for you to copy into your Wrangler configuration file, which will help ensure your Wrangler configuration file is always up to date.*

即：**只要使用 Wrangler，就应把 `wrangler.jsonc` 当作唯一真相源，避免在 Dashboard 直接改配置**。若必须在 Dashboard 改，Dashboard 会生成一段 TOML 片段让你拷回配置文件以保持同步。

### 4.2 覆盖规则（谁覆盖谁）

| 在 Dashboard 改了什么 | 下一次 `wrangler deploy` 会怎样 |
|----------------------|-------------------------------|
| **Environment variables（`vars`）** | **默认被 wrangler.jsonc 覆盖**（Dashboard 的值丢失）。若需保留 Dashboard 的值，需在 `wrangler.jsonc` 顶层加 `"keep_vars": true`，则 Wrangler 不再覆盖 Dashboard 上的 vars。 |
| **Routes / Custom Domains** | 同样被 `wrangler.jsonc` 的 `route`/`routes` 覆盖。若想完全由 Dashboard 管理路由，需从 `wrangler.jsonc` 中移除 `route`/`routes` 键，并加 `"workers_dev": false`（文档注明此为从 Dashboard 管理路由的官方做法）。 |
| **Secrets** | 互不覆盖：Secret 值不在 `wrangler.jsonc` 中（仅声明 `secrets.required`），Dashboard 与 `wrangler secret put` 写入的是同一远端存储，`deploy` 不会清空已有的 Secret（除非显式 `secret delete`）。 |
| **Bindings（D1/KV/R2 等）** | 以 `wrangler.jsonc` 为准；Dashboard 上绑定的资源会在下次 deploy 时被配置文件中的 `d1_databases`/`kv_namespaces` 等覆盖。若 wrangler.jsonc 中该 binding 缺失，Dashboard 上的对应绑定会被移除（因为配置即声明式全量同步）。 |

> 来源：Source of truth 小节末两段 + Top-level only keys 中 `keep_vars` 条目。

**`keep_vars` 唯一作用**：控制 `vars` 是否保留 Dashboard 值。**不影响** `d1_databases` / `kv_namespaces` / `r2_buckets` / `secrets` / `routes` 的覆盖行为。社区 Issue #276 也确认此语义。

### 4.3 两种路径的全面对比

| 维度 | wrangler.jsonc 路径（官方推荐） | Dashboard Variables 路径 |
|------|-------------------------------|-------------------------|
| **版本控制** | 配置在 Git，PR 可审计、可回滚、可做类型检查 `wrangler types` | Dashboard 手动操作，无 Git 历史，需额外文档记录 |
| **可重复部署** | `wrangler deploy` / CI 一键复刻；`--dry-run` 可预检大小 <3MB gzip | 换环境/重建 Worker 需手动重填，易遗漏 |
| **新特性支持** | 「部分新 Wrangler 特性仅对 JSON 配置开放」（官方原话） | 无法使用仅 JSON 配置支持的新特性 |
| **Bindings 声明** | 声明式，D1/KV/R2 全量同步，`wrangler types` 生成 `Env` 类型 | Dashboard 绑定的 D1/KV 在下次 deploy 时会被 wrangler.jsonc 覆盖或清空（若配置缺失） |
| **Vars 覆盖** | 默认覆盖 Dashboard 的 vars（可通过 `keep_vars: true` 保留） | 若 `keep_vars: true`，本地配置与远端不一致风险增高，难以追踪 |
| **Secrets 管理** | 声明 `secrets.required` + `wrangler secret put` / `--secrets-file` 批量上传，CI 可 `wrangler deploy --secrets-file .env.production` | Dashboard `Variables and Secrets → Secret` 同样可行，但需手动，且值不可见 |
| **本地开发** | `.dev.vars` / `.env` 与 `wrangler.jsonc` 一致，`wrangler dev --local` / `--remote` 精确控制 | Dashboard 的 vars/secrets 不会自动同步到本地，需手动维护 `.dev.vars` |
| **自动供应** | 不写 `id` 即可 `wrangler deploy` 自动创建并回写 ID 到文件 | Dashboard/GitHub 部署时创建的资源 ID 不会回写到仓库（文档明确提示） |
| **多人协作** | 单一真相源，避免"配置漂移" | 极易出现"谁在 Dashboard 改过 vars 却没拷回配置文件" 的漂移 |

### 4.4 官方推荐结论

**Cloudflare 官方推荐：坚持 wrangler.jsonc 作为 Source of Truth，Dashboard 仅作为 Secret 的可视化/应急入口。**

- 若你"需要同时在 Dashboard 改 vars 而不想被覆盖"，才考虑 `keep_vars: true`，但官方将其定位为例外而非默认。
- Dashboard 仍可改 Secret、查看日志、绑定 Custom Domain（若已从 wrangler.jsonc 移除 routes 时）等，但**所有 bindings 与 vars 的变更最终都应拷回 wrangler.jsonc**。
- 对于通过 GitHub/Workers Builds 部署的项目，若采用"仅 binding 无 ID"的自动供应，远端创建的资源 ID 无法回写到仓库，**更应显式在 wrangler.jsonc 中声明并提交 ID**，以保持可移植性。

---

## 5. 给 Mizuki 的最小可用配置与行动建议

### 5.1 当前 `wrangler.jsonc` 诊断（2026-08-30 实际文件）

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

**缺失**：`d1_databases` / `kv_namespaces` 绑定已在当前文件中被移除（用于对比 Dashboard 路径），本地 `astro dev` 仍可跑（回退到 mock/R2-less），但 `wrangler deploy`/`wrangler dev --remote` 将无 `env.DB` / `env.SESSION`，better-auth 的 Drizzle+D1 链路会失败。

### 5.2 官方推荐的最小可用配置（恢复 bindings）

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "mizuki-blog",
  "compatibility_date": "2026-08-30",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@astrojs/cloudflare/entrypoints/server",
  "assets": {
    "binding": "ASSETS",
    "directory": "./dist",
    "not_found_handling": "404-page" // 可选，对应 src/pages/404.astro
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mizuki-db",
      "database_id": "<填 wrangler d1 list 返回的 UUID>",
      "migrations_dir": "migrations"
      // 可选：若用 Drizzle 嵌套布局则加 "migrations_pattern": "migrations/*.sql"
      // 可选：若需本地 --remote 隔离则加 "preview_database_id": "<preview UUID>"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "SESSION",
      "id": "<填 wrangler kv namespace list 返回的 id>"
      // 可选 preview_id
    }
  ],
  // R2 当前未用，如需对象存储（壁纸/上传）再加：
  // "r2_buckets": [{ "binding": "BLOG_BUCKET", "bucket_name": "mizuki-blog-bucket" }],
  "vars": {
    // 仅放非敏感配置；敏感项走 secrets
    "BETTER_AUTH_URL": "https://mizuki-blog.workers.dev" // 生产默认；本地由 .dev.vars 覆盖为 http://localhost:4321
  },
  "secrets": {
    "required": ["BETTER_AUTH_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]
  },
  "observability": { "enabled": true }
}
```

可选的顶层异常开关（不推荐默认启用）：

```jsonc
{
  "keep_vars": true // 仅当你坚持在 Dashboard 改 vars 且不想被 wrangler deploy 覆盖时才加；会增加漂移风险
}
```

### 5.3 Secrets / Vars 的矩阵（已与当前 Mizuki 实践对齐）

| 变量 | 类型 | 本地 `.dev.vars` | 远端 |
|------|------|------------------|------|
| `BETTER_AUTH_SECRET` | Secret | `.dev.vars` | `wrangler secret put BETTER_AUTH_SECRET` |
| `GITHUB_CLIENT_SECRET` | Secret | `.dev.vars` | `wrangler secret put GITHUB_CLIENT_SECRET` |
| `GITHUB_CLIENT_ID` | Secret* | `.dev.vars` | `wrangler secret put` 或 `vars`（建议统一走 Secret 以享类型校验） |
| `BETTER_AUTH_URL` | Var | `.dev.vars` (`http://localhost:4321`) | `wrangler.jsonc: vars.BETTER_AUTH_URL` （远端）或按环境用 `env.production.vars` |

* `GITHUB_CLIENT_ID` 虽非绝对敏感，但 better-auth 示例与官方 Secrets 最佳实践均建议将其与 `CLIENT_SECRET` 同走 Secret 通道，可享 `secrets.required` 的部署前校验。

本地校验：`wrangler types` 会基于 `wrangler.jsonc` 的 bindings+`secrets.required` 生成 `Env` 类型，`wrangler dev` 会在缺失 required secret 时告警。

### 5.4 本地与远端 D1 的正确用法

```bash
pnpm db:generate                # drizzle-kit generate（生成 migrations）
pnpm db:migrate:local           # wrangler d1 migrations apply DB --local  （Miniflare 本地模拟）
pnpm db:migrate:remote          # wrangler d1 migrations apply DB --remote （生产 D1）

# 调试
wrangler d1 execute mizuki-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"
wrangler d1 execute mizuki-db --remote --command "SELECT count(*) FROM posts"
wrangler d1 export mizuki-db --remote --output dump.sql
```

若需在本地 dev 时直连远端 D1 进行对比，可在 `wrangler.jsonc` 的 D1 绑定中临时加 `"remote": true`，但日常开发保持本地模拟以避免误写生产数据。

### 5.5 行动建议（Downstream 决策）

**建议：恢复 `wrangler.jsonc` 的 `d1_databases` + `kv_namespaces` 绑定，坚持"wrangler.jsonc 为真相源"，Dashboard Variables 仅保留 Secret 的应急改动入口。**

理由：

1. 官方自 2026-08-28 文档起已将 JSON 列为首选且部分新特性仅 JSON 可用；Mizuki 已用 `wrangler.jsonc`，符合正轨。
2. 若坚持 Dashboard Variables 而不在 `wrangler.jsonc` 声明 bindings，下次 `wrangler deploy` 会**清空或覆盖**远端绑定，导致 `env.DB` 丢失；`keep_vars` 也救不了 bindings。
3. 当前 `wrangler.jsonc` 缺 bindings 已导致本地与远端不一致，CI 的 `wrangler deploy` 也无法声明式重建 D1/KV。
4. 自动供应（无 ID 绑定）虽可零配置起步，但 ID 不回写到仓库，不利于"删库重建"与 `wrangler types` 一致性；对已有 `mizuki-db` 应显式写回 `database_id`/`id`。

**迁移步骤**（按官方 Source of truth 流程）：

1. `wrangler d1 list --json` / `wrangler kv namespace list --json` 取回生产 ID；
2. 将 `d1_databases` / `kv_namespaces` 写回 `wrangler.jsonc`（见 5.2 模板）；
3. `wrangler secret put BETTER_AUTH_SECRET` 等 Secret 保持通过 CLI 写入（或 Dashboard Secret 类型），本地保留 `.dev.vars`；
4. `pnpm build && wrangler deploy --dry-run` 确认 <3MB gzip，再 `wrangler deploy`；
5. 若曾在 Dashboard 改过 vars，Dashboard 会显示 TOML 片段，拷回 `wrangler.jsonc` 的 `vars` 后提交，避免 `keep_vars: true`。

替代方案（仅当团队坚持全 Dashboard 运营时）：移除 `wrangler.jsonc` 中的 `vars`/`d1_databases`/`kv_namespaces` 并依赖 Dashboard 绑定，但需接受**无法版本控制、无法 `wrangler types`、无法自动供应回写、deploy 覆盖风险**等代价 — 官方不推荐此路径。

---

## 参考来源（按引用顺序）

- https://developers.cloudflare.com/workers/wrangler/configuration/ — Wrangler Configuration（Wrangler v3.91.0+ JSON 首选、Source of truth、keep_vars、Automatic provisioning、d1_databases/kv_namespaces/r2_buckets/vars/secrets 绑定定义）
- https://developers.cloudflare.com/workers/frameworks/framework-guides/astro/ — Astro on Workers（C3/Automatic configuration、Manual configuration 静态 vs SSR、bindings、Sessions、.assetsignore、404、Node 要求）
- https://developers.cloudflare.com/workers/configuration/environment-variables/ — Environment variables（Wrangler vars、Dashboard vars、.dev.vars/.env、process.env 透传）
- https://developers.cloudflare.com/workers/configuration/secrets/ — Secrets（secret put/bulk、secrets.required、本地开发）
- https://developers.cloudflare.com/workers/wrangler/environments/ — Environments（Non-inheritable 需每环境重写）
- https://developers.cloudflare.com/d1/wrangler-commands/ — D1 Wrangler commands（create/list/execute/export/migrations/time-travel、--local/--remote/--preview）
- https://developers.cloudflare.com/d1/reference/migrations/ — D1 Migrations（migrations_dir/pattern、d1_migrations 表、外键）
- https://developers.cloudflare.com/workers/local-development/ — Local development（Miniflare、默认本地模拟、remote: true、wrangler dev --remote Legacy）
- https://developers.cloudflare.com/workers/runtime-apis/bindings/ — Bindings (env)（env 访问方式、withEnv、全局 env）
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/ — Workers Best Practices（vars vs secrets、compatibility_date、nodejs_compat）
- https://developers.cloudflare.com/changelog/2025-10-24-automatic-resource-provisioning/ — Automatic Resource Provisioning Beta
