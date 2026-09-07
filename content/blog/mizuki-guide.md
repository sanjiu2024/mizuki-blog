---
title: "Mizuki 主题使用指南"
description: "从写作到部署，带你快速掌握 Mizuki 主题的 Markdown 写作、代码高亮与宝塔上线全流程。"
pubDate: 2026-09-07
author: "Mizuki"
heroImage: "/images/mizuki-cover.jpg"
tags: ["Mizuki", "Astro", "宝塔"]
---

## 简介

欢迎使用 Mizuki 主题。这是一套为中文博客优化的 Astro 主题，注重阅读体验与视觉细节。

- 开箱即用的封面、标签与目录
- 优雅的中文排版与暗色模式
- 支持代码高亮、数学公式与图片灯箱
- 可一键部署到宝塔面板

> 本文是示例文章，同时演示了 Mizuki 主题常用的 Markdown 写法，你可以直接复制它的结构开始写作。

## 快速开始

在 `content/blog/` 目录下新建 Markdown 文件即可发布一篇文章， frontmatter 写法如下：

```bash
content/blog/
  mizuki-guide.md
  my-first-post.md
```

新建文件后，写入标题、描述、日期与标签，保存刷新就能在首页看到。建议封面图放在 `public/images/` 目录下，用 `/images/xxx.jpg` 引用。

## 写作技巧

### Markdown 基础

日常写作只需要掌握这几个符号：

- `#` 表示标题，`##` 是二级标题，建议一篇文章只用一个一级标题
- `-` 表示无序列表，`1.` 表示有序列表
- `**加粗**` 与 `*斜体*` 用于强调
- `[文字](链接)` 插入链接，`![说明](图片地址)` 插入图片

### 代码高亮

Mizuki 会自动高亮代码块，记得标注语言：

```ts
export function greeting(name: string): string {
  return `你好，${name}，欢迎来到 Mizuki 博客！`;
}

console.log(greeting("读者"));
```

常用的 Shell 命令这样写：

```bash
pnpm install
pnpm dev
pnpm astro check
```

### 数学公式

主题支持 KaTeX 风格的数学公式，行内用 `$...$`，独立公式用 `$$...$$`：

$$S(n) = \sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$

当 $n = 100$ 时，$S(n) = 5050$。

### 图片

图片建议统一放在 `public/images/` 目录，写法如下：

![Mizuki 封面示意](/images/mizuki-cover.jpg)

小技巧：给图片加上有意义的替代文字，既利于搜索收录，也方便读者使用读屏软件。

| 用法 | 写法 | 说明 |
| --- | --- | --- |
| 本地图片 | `![说明](/images/xxx.jpg)` | 推荐，加载最快 |
| 远程图片 | `![说明](https://...)` | 适合引用外部资源 |
| 封面图 | frontmatter 的 `heroImage` | 显示在文章顶部 |

## 部署到宝塔

在宝塔面板上部署 Node 版本的 Mizuki 博客，只需要四步：

1. 在宝塔应用商店安装 Node.js 与 Nginx，进入网站目录拉取代码
2. 执行 `pnpm install` 安装依赖，执行 `pnpm build` 生成 `dist/` 产物
3. 用 PM2 启动服务，启动命令为 `node ./dist/server/entry.mjs`，端口按面板提示填写
4. 在 Nginx 反向代理中指向 Node 端口，申请 SSL 证书后强制 HTTPS 访问

> 记得在宝塔环境变量中配置站点地址与数据库路径，更新后用 `pm2 reload` 平滑重启即可。

## 常见问题

**目录没有自动生成怎么办？**

检查文章是否使用了二级与三级标题，Mizuki 的目录是根据 `##` 与 `###` 自动生成的，一级标题不会进入目录。

**封面图不显示怎么办？**

确认 `heroImage` 路径以 `/` 开头且文件真实存在于 `public/` 目录，例如 `/images/mizuki-cover.jpg` 对应 `public/images/mizuki-cover.jpg`。

**从 Hexo 或 Hugo 迁移要注意什么？**

把旧文章的 `date` 改为 `pubDate`，把 `cover` 改为 `heroImage`，标签统一为数组格式，批量复制到 `content/blog/` 即可。
