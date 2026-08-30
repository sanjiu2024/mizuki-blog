# Development

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 本地开发 localhost:4321 |
| `pnpm build` | 生产构建 dist/ + _worker.js |
| `pnpm astro check` | Astro 类型检查 |
| `pnpm db:generate` | Drizzle 生成迁移 |
| `pnpm db:migrate:local` | 本地 D1 迁移 |
| `pnpm db:migrate:remote` | 远端 D1 迁移 |
| `wrangler dev` | 本地 Workers 运行时 |
| `wrangler d1 execute DB --local --command "..."` | 本地 D1 查询 |

新增文章：在 seed.ts 加数据或 wrangler d1 execute INSERT。
新增标签：INSERT INTO tags + post_tags 关联。
评论：POST /api/comments 需登录。
搜索：GET /api/search?q=keyword 返回 rank/snippet。
