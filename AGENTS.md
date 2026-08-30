## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## 常用命令

| 命令                                             | 说明                      |
| ------------------------------------------------ | ------------------------- |
| `pnpm install`                                   | 安装依赖                  |
| `pnpm dev`                                       | 本地开发 `localhost:4321` |
| `pnpm build`                                     | 生产构建 `dist/`          |
| `pnpm preview`                                   | 预览构建产物              |
| `pnpm astro check`                               | Astro 类型检查            |
| `pnpm db:generate`                               | Drizzle 生成迁移          |
| `pnpm db:migrate:local`                          | 本地 D1 迁移              |
| `pnpm db:migrate:remote`                         | 远端 D1 迁移              |
| `pnpm deploy`                                    | 构建并 `wrangler deploy`  |
| `wrangler dev`                                   | 本地 Workers 运行时       |
| `wrangler d1 execute DB --local --command "..."` | 本地 D1 查询              |

## Documentation

Full documentation: https://docs.astro.build

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
