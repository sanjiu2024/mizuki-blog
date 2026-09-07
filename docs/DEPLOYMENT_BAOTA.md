# 宝塔面板部署手册 — Mizuki Blog（保姆级，零基础可照做）

> 目标：把本仓库（`main` 分支，`Astro 7 + Node.js + SQLite + PM2`）部署到任意已装宝塔面板的 VPS/云服务器（2核2G + 40G 硬盘即可），全程面板点选 + 3 条命令，无需手写 `nginx.conf`。
>
> 已验证：宝塔面板 11.x + Node版本管理器 2.7+ + Node v22 LTS + Nginx 1.20+ + PM2 + `better-sqlite3` 文件库。

---

## 0. 总览（5 分钟看懂）

| 步骤 | 做什么 | 在哪做 | 耗时 |
|---|---|---|---|
| 1 | 买服务器、装宝塔、绑域名 | 宝塔官网 + 域名商 + 云厂商安全组 | 5 分钟 |
| 2 | 装 Node v22 + Nginx + pnpm | 宝塔 → 软件商店 / 终端 | 3 分钟 |
| 3 | 拉代码、改 1 个域名、装依赖、建库 | 终端 `git clone` + `pnpm build` + `drizzle-kit push` | 3 分钟 |
| 4 | PM2 启动 `dist/server/entry.mjs` | 宝塔 → 网站 → Node项目 **或** `ecosystem.config.cjs` | 1 分钟 |
| 5 | Nginx 反代 `127.0.0.1:4321` → 域名 | 宝塔 → 网站 → 反向代理 | 1 分钟 |
| 6 | HTTPS Let's Encrypt 一键申请 | 宝塔 → 网站 → SSL | 1 分钟 |

**最终效果**：`https://blog.example.com` 打开即 Mizuki 首页（Banner 65vh + 4 层波浪 + Swup 120ms），`/login` 支持 GitHub/邮箱登录，`/admin` 可发文，评论楼中楼 + 点赞，搜索 FTS5 + RSS/归档/标签均可用。

**与 Cloudflare 版的区别**（已在 `cloudflare` 分支归档）：

|  | Cloudflare Workers（`cloudflare` 分支） | 宝塔 Node（`main` 分支，本文） |
|---|---|---|
| 适配器 | `@astrojs/cloudflare` | `@astrojs/node` `mode: "standalone"` |
| 数据库 | D1 `env.DB` + `wrangler d1` | `better-sqlite3` 文件 `./data/mizuki.db`（`libsql` 兼容） |
| 会话 | KV `SESSION` | 文件系统（`better-auth` 会话已在 SQLite） |
| 部署 | `wrangler deploy` / Dashboard 自动构建 | `pm2` + Nginx 反代 |
| 日志 | `wrangler tail` / Dashboard Logs | `pm2 logs` + `./logs/error.log` |

> `migrations/*.sql`（含 FTS5 `porter unicode61` 触发器）与 `src/db/schema.ts` 在两分支间**零改动**，后续切回 Cloudflare 只需反向执行 §2。

---

## 1. 准备工作（买服务器 + 装宝塔 + 域名）

### 1.1 买一台 VPS（已有可跳过）

- 推荐：腾讯云/阿里云/雨云 2核2G + 40G 硬盘 + 3M 带宽（学生/轻量均可），系统选 **Ubuntu 22.04 LTS** 或 **Debian 12**（CentOS 7 已 EOL，不推荐）。
- 安全组：入方向放行 `22(SSH)` / `8888(宝塔)` / `80` / `443`，出方向全放行。**`4321` 无需放行**（仅本机 `127.0.0.1:4321`，外网通过 `80/443` 经 Nginx 转发）。

### 1.2 装宝塔面板（新机器执行，已有可跳过）

```bash
# 以 Ubuntu 为例（Debian 同理），SSH 连上服务器后执行宝塔官方脚本
wget -O install.sh https://download.bt.cn/install/install-ubuntu.sh && sudo bash install.sh ed8484bec
# 按提示按 y，回车，等待 2-3 分钟，记下输出的：
#   Bt-Panel: https://<你的IP>:8888/xxxxx
#   username: xxxxx
#   password: xxxxx
```

浏览器打开 `https://<IP>:8888/xxxxx`，用账号密码登录，首次会弹 **推荐安装套件**，选 **LNMP**（Nginx 1.22 + MySQL 可不装，本项目用 SQLite 无需 MySQL）→ 一键安装，等待 5 分钟。

> 若 `8888` 打不开，去云厂商安全组确认已放行 `8888`，或 `bt 14` 查看面板入口。

### 1.3 域名解析（已有域名可跳过）

1. 域名商（阿里云/腾讯云/Cloudflare）→ DNS 解析 → 添加 **A 记录**：
   - 主机记录：`blog`（或 `@` 表示根域）
   - 记录值：填 VPS 的公网 IP
   - TTL：`600`
2. 等待 5-10 分钟生效，`ping blog.example.com` 能通即生效。

---

## 2. 宝塔内安装运行环境（软件商店点选）

### 2.1 安装 Node版本管理器（必装）

宝塔左侧 **软件商店** → 搜索 `Node版本管理器` → 点 **安装**（版本 `2.7+`）→ 安装完点 **设置**。

### 2.2 安装 Node v22 LTS（Astro 7 必需，勿用 v18/v20 旧例）

`Node版本管理器` → **安装新版本** → 选 **`v22.12.0` 或 `v22.x LTS`** → 点 **安装**，等待 2 分钟。

安装完：

- **命令行版本** 下拉选 `v22.x` → **切换**
- 终端验证：
  ```bash
  node -v        # 期望 v22.x（如 v22.12.0）
  npm -v
  which node     # /www/server/nodejs/v22.12.0/bin/node
  ```

> **为什么必须是 v22**：本项目 `package.json` 声明 `engines: ">=22.12.0"`，Astro 7 的 `sharp`/`vite` 在 v18 下会编译失败。

### 2.3 安装 Nginx

软件商店 → 搜索 `Nginx` → 选 `1.22` 或 `1.24` → **安装** → 等待 2 分钟 → 安装完确保状态为 **运行中**。

### 2.4 安装 pnpm + PM2（终端执行，2 条命令）

宝塔左侧 **终端**（或 SSH），执行：

```bash
npm i -g pnpm@10 pm2
pnpm -v   # 10.x
pm2 -v    # 5.x
```

> `pm2` 为 Node 项目的守护进程，宝塔的 **网站 → Node项目** 底层即 `pm2`，无需额外配置。

---

## 3. 拉代码 + 改域名 + 建库（终端 3 条核心命令）

### 3.1 创建站点目录并拉代码

**方式 A：用 git（推荐，可 `git pull` 更新）**

```bash
# 以 blog.example.com 为例，目录固定用 /www/wwwroot/blog.example.com（宝塔约定）
sudo mkdir -p /www/wwwroot
cd /www/wwwroot
sudo git clone -b main https://github.com/sanjiu2024/mizuki-blog.git blog.example.com
# 若私有仓库，改用 SSH 或 宝塔 → 终端 → ssh-keygen 后加 Deploy Keys
sudo chown -R www:www blog.example.com
cd blog.example.com
```

**方式 B：用宝塔文件管理器上传 zip**

宝塔 → **文件** → `/www/wwwroot` → **上传** → 选本仓库 `main` 分支的 zip → 解压到 `blog.example.com` → 同样 `chown -R www:www`。

### 3.2 改 1 个域名（唯一必改）

用宝塔 **文件** → 打开 `/www/wwwroot/blog.example.com/astro.config.mjs`，把 `site: "https://blog.example.com"` 改为你的真实域名：

```js
// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://blog.example.com", // ← 改为你的域名，如 https://blog.yourdomain.com
  output: "server",
  adapter: node({ mode: "standalone" }),
  vite: { plugins: [tailwindcss()] },
});
```

> 不改也能跑，但 RSS/OG/站点地图的 `https://...` 会错。

### 3.3 安装依赖 + 构建 + 建库（3 条命令，约 2 分钟）

```bash
cd /www/wwwroot/blog.example.com

# 1. 安装依赖（用 pnpm，保持与 lockfile 一致）
pnpm install --frozen-lockfile

# 2. 类型检查（可选，但推荐，0 errors 方可继续）
pnpm astro check
# 期望：0 errors，3 hints 可忽略

# 3. 构建（产物 dist/server/entry.mjs + dist/client/）
pnpm build
# 期望：[build] Complete! 3-5s

# 4. 建本地 SQLite 库（D1 → better-sqlite3，FTS5 自动包含）
mkdir -p data logs
chown -R www:www data logs
pnpm exec drizzle-kit push
# 按提示选 Yes，生成 ./data/mizuki.db
# 若提示 Better Auth 表已存在，选 Yes 覆盖即可

# 5. 验证库已生成
ls -lh data/mizuki.db*
# 应看到 data/mizuki.db  ~200KB + data/mizuki.db-wal/shm（WAL 模式）
sqlite3 ./data/mizuki.db "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
# 应看到 9 行：account/comment_reactions/comments/post_tags/posts/posts_fts/session/tags/users/verification
sqlite3 ./data/mizuki.db "SELECT slug, title FROM posts;"
# 应看到 3 行 seed：hello-mizuki / second-post / mizuki-deep-dive（若无，手动执行 pnpm exec drizzle-kit push 再试）

# 6. 授权（关键，宝塔以 www 用户运行 Node）
chown www:www ./data/mizuki.db*
chmod 755 ./data
```

> **若 `drizzle-kit push` 报 `better-sqlite3` 编译失败**：`Node版本管理器` 切 `v22` 重装，或 `pnpm add better-sqlite3 --ignore-scripts=false` 重试（本仓库已用 `@libsql/client` 免编译，可忽略）。

---

## 4. PM2 启动（两种方式二选一，新手选 A）

### 方式 A：宝塔面板点选（零命令，推荐新手）

1. 宝塔左侧 **网站** → 顶部 **Node项目** → **添加Node项目**
2. 弹窗填写（严格按此）：

| 字段 | 填写 |
|---|---|
| **项目名称** | `mizuki-blog`（任意） |
| **项目目录** | `/www/wwwroot/blog.example.com`（点文件夹图标选择） |
| **启动文件** | `dist/server/entry.mjs`（点选择，或手动输入） |
| **项目端口** | `4321`（勿改，与 `ecosystem.config.cjs` 一致） |
| **Node版本** | `v22.12.0`（下拉选你装的 v22） |
| **运行用户** | `www`（默认） |
| **包管理器** | `pnpm` |
| **备注** | 可空 |

3. 点 **提交**，等待 10-20 秒，状态变为 **运行中**。

4. 点 **设置**（或项目名）→ **环境变量** → **添加** 下列 7 项（**HOST/PORT 必须**，其余按需）：

| 变量名 | 值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 仅本机监听，安全 |
| `PORT` | `4321` | 与上表一致 |
| `DB_FILE_NAME` | `./data/mizuki.db` | 相对路径，相对于项目目录 |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` 的输出（本地跑此命令复制一串，32 字符以上） | 生产密钥，勿用 `dev-secret-please-change...` |
| `BETTER_AUTH_URL` | `https://blog.example.com` | 必须与 `astro.config.mjs` 的 `site` 一致，且与 SSL 后的 https 一致 |
| `GITHUB_CLIENT_ID` | `Ov23li...`（GitHub OAuth App 的 Client ID） | 若不用 GitHub 登录可不填，填则需配对 |
| `GITHUB_CLIENT_SECRET` | `xxx`（GitHub OAuth App 的 Client Secret） | 同上 |

> **如何生成 `BETTER_AUTH_SECRET`**：本地终端（或宝塔终端）执行 `openssl rand -base64 32` 复制输出；无 `openssl` 可用 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`。

> **GitHub OAuth（可选）**：若需 GitHub 登录，去 https://github.com/settings/developers → **OAuth Apps → New OAuth App** → **Application name: Mizuki** → **Homepage URL: https://blog.example.com** → **Authorization callback URL: https://blog.example.com/api/auth/callback/github** → **Register** → 复制 `Client ID / Generate Client Secret`。

5. 保存后点 **重启**，等待 5 秒。

6. 验证：

```bash
curl -I http://127.0.0.1:4321
# HTTP/1.1 200 OK

curl -s http://127.0.0.1:4321/api/health | head
# {"ok":true,"ts":...}（若无此路由，curl / 应返回 <!DOCTYPE html>）
pm2 list  # 或宝塔 → Node项目 → 日志，应看到 Server listening on http://127.0.0.1:4321
```

> 若 `curl 502`，看 **Node项目 → 日志**，常见为 `SQLITE_CANTOPEN` → 回 §3.3 执行 `chown -R www:www data`。

### 方式 B：配置文件 `ecosystem.config.cjs`（推荐生产，可进 git，已在仓库）

本仓库根已自带 `ecosystem.config.cjs`：

```js
module.exports = {
  apps: [{
    name: "mizuki-blog",
    script: "./dist/server/entry.mjs",
    cwd: "/www/wwwroot/blog.example.com",
    instances: 1,          // 单文件 SQLite 必须 1 实例 + fork，勿用 cluster/max
    exec_mode: "fork",
    autorestart: true,
    restart_delay: 5000,
    max_memory_restart: "512M",
    env: {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "4321",
      DB_FILE_NAME: "./data/mizuki.db",
      BETTER_AUTH_SECRET: "openssl rand -base64 32 生成的一串",
      BETTER_AUTH_URL: "https://blog.example.com",
      GITHUB_CLIENT_ID: "Ov23...",
      GITHUB_CLIENT_SECRET: "xxx"
    },
    error_file: "./logs/error.log",
    out_file: "./logs/out.log",
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss"
  }]
};
```

终端执行：

```bash
cd /www/wwwroot/blog.example.com
# 先把上面的 BETTER_AUTH_SECRET 等 4 项填入 ecosystem.config.cjs 的 env
nano ecosystem.config.cjs  # 改完 Ctrl+O 保存，Ctrl+X 退出

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # 按提示复制 sudo env PATH=... 那一行并执行，使重启后自启
pm2 status   # 应显示 online
pm2 logs mizuki-blog --lines 20  # 期望 Server listening on http://127.0.0.1:4321
curl -I http://127.0.0.1:4321  # 200
```

> **SQLite 特别注意**：`instances: 1` + `fork`，`cluster`/`max` 会多进程抢写 `.db-wal` 导致 `SQLITE_BUSY: database is locked`。要扩容先迁 PostgreSQL。

---

## 5. Nginx 反向代理（面板点选，30 秒）

### 5.1 创建站点（若还没有）

宝塔 → **网站** → **添加站点** → **域名** 填 `blog.example.com`（及 `www.blog.example.com` 如需）→ **数据库 不创建** → **PHP版本 纯静态** → **提交**。

> 若已通过 **Node项目** 自动创建了站点，可跳过此步，直接在已有站点上加反代。

### 5.2 添加反向代理

1. 宝塔 → **网站** → 找到 `blog.example.com` → 点 **设置** → **反向代理** → **添加反向代理**
2. 填写：

| 字段 | 填写 |
|---|---|
| **代理名称** | `mizuki`（任意） |
| **目标URL** | `http://127.0.0.1:4321` |
| **发送域名** | `$host`（下拉选） |

3. 点 **提交**，等待 3 秒。

4. 测试：浏览器打开 `http://blog.example.com`（先 http，https 后面加）应直接显示 Mizuki 首页（Banner 65vh + 4 层波浪）。若 `502 Bad Gateway`，检查 §4 的 `curl -I http://127.0.0.1:4321` 是否 200，若不是，`pm2 logs` 看 `Server listening` 端口是否 4321。

### 5.3 静态资源直供（可选，提速 1 年缓存）

`standalone` 模式已自带静态服务，但 Nginx 直接 `alias` 更快（面板可不配，不影响功能）：

```nginx
# 宝塔 → 网站 → blog.example.com → 配置文件 → 在 server { } 内添加（可选）
location /_astro/ {
  alias /www/wwwroot/blog.example.com/dist/client/_astro/;
  expires 1y;
  add_header Cache-Control "public, immutable";
  access_log off;
}
```

等价面板操作：**反向代理** 无法直接配 `alias`，需 **配置文件** 手写，此步可跳过。

### 5.4 完整手写 `nginx.conf`（等价，供排错参考）

```nginx
server {
  listen 80;
  server_name blog.example.com;

  # 可选：静态直供
  location /_astro/ {
    alias /www/wwwroot/blog.example.com/dist/client/_astro/;
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

## 6. HTTPS（Let's Encrypt，一键）

1. 宝塔 → **网站** → 选中 `blog.example.com` → **SSL** → **Let's Encrypt**
2. 勾选 `blog.example.com` + `www.blog.example.com`（如有 www 解析）
3. **验证方式** 选 **文件验证**（默认）
4. 点 **申请**，等待 30-60 秒，提示 **申请成功**
5. 开启 **强制HTTPS**（右上角开关）
6. 浏览器打开 `https://blog.example.com` 应为小绿锁。

> **宝塔自动续期**：Let's Encrypt 90 天到期，宝塔会在到期前 30 天自动续期，无需手动。

7. 同步改 2 处为 `https`：

| 位置 | 改为 |
|---|---|
| `ecosystem.config.cjs` 或 宝塔 Node项目 → 环境变量 的 `BETTER_AUTH_URL` | `https://blog.example.com` |
| GitHub OAuth App 的 **Authorization callback URL**（https://github.com/settings/developers → 你的 App → Edit） | `https://blog.example.com/api/auth/callback/github`（追加一条，原 `http://localhost:4321/...` 可保留用于本地） |

改完 `pm2 restart mizuki-blog`。

---

## 7. 验证清单（逐项打勾）

```bash
# 1. Node 监听
curl -I http://127.0.0.1:4321          # 200
pm2 list                               # mizuki-blog online
pm2 logs mizuki-blog --lines 20        # Server listening on http://127.0.0.1:4321

# 2. Nginx 反代
curl -I http://blog.example.com        # 200（经 Nginx）
curl -I https://blog.example.com       # 200（经 HTTPS）

# 3. 页面
curl -s https://blog.example.com/ | grep -q "mizuki" && echo "首页 OK"
curl -s https://blog.example.com/rss.xml | head -n 5
curl -s https://blog.example.com/sitemap.xml | head -n 5
curl -s https://blog.example.com/api/health | grep -q ok && echo "健康检查 OK" || echo "无 health 路由可跳过"

# 4. 数据库
sqlite3 ./data/mizuki.db "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
# 9 行：account/comments/comment_reactions/post_tags/posts/posts_fts/session/tags/users/verification
sqlite3 ./data/mizuki.db "SELECT slug FROM posts;"
# 3 行：hello-mizuki / second-post / mizuki-deep-dive

# 5. 登录
# 浏览器打开 https://blog.example.com/login → 点 GitHub 登录 → 授权 → 回跳首页 header 显示头像
# 或邮箱注册 → 登录 → 访问 https://blog.example.com/admin 应 403（非 admin）/ 200（admin）

# 6. 设首个 admin
sqlite3 ./data/mizuki.db "UPDATE users SET role='admin' WHERE email='你的GitHub邮箱';"
# 重新登录后访问 /admin 应可看到文章列表
```

---

## 8. 常用运维（更新、备份、日志）

```bash
# 查看状态/日志
pm2 status
pm2 logs mizuki-blog          # 实时
pm2 logs mizuki-blog --lines 100
cat ./logs/error.log | tail -n 50
cat ./logs/out.log | tail -n 50

# 重启/重载
pm2 restart mizuki-blog
pm2 reload mizuki-blog        # 零停机重载（单实例等价 restart）

# 更新代码（发布新文章或拉新功能）
cd /www/wwwroot/blog.example.com
git pull                      # 拉 main 最新
pnpm install --frozen-lockfile
pnpm build
pm2 restart mizuki-blog

# 备份数据库（建议每日 cron）
cp ./data/mizuki.db ./data/mizuki.db.bak.$(date +%Y%m%d)
sqlite3 ./data/mizuki.db ".dump" > ./data/dump.sql
# 恢复：sqlite3 ./data/mizuki.db < ./data/dump.sql

# 查看数据库内容
pnpm exec drizzle-kit studio  # 浏览器打开 https://local.drizzle.studio
# 或 sqlite3 ./data/mizuki.db "SELECT * FROM posts;"
```

**宝塔面板对应操作**：

| 命令 | 面板位置 |
|---|---|
| `pm2 status/logs/restart` | 网站 → Node项目 → 对应项目的 **日志/重启/停止** 按钮 |
| 查看 `data/mizuki.db` | 文件 → `/www/wwwroot/blog.example.com/data` → 右键下载 |
| 改环境变量 | Node项目 → 设置 → 环境变量 |

---

## 9. 排错表（按现象定位，90% 问题在此）

| 现象 | 原因 | 修复 |
|---|---|---|
| `502 Bad Gateway`（Nginx） | Node 未监听 `127.0.0.1:4321` / 端口填错 | `pm2 logs` 看 `Server listening` 是否 4321，回 **反向代理** 的目标 URL 是否 `http://127.0.0.1:4321` |
| `SQLITE_CANTOPEN: unable to open database file` | `data/` 非 `www` 可写 | `chown -R www:www data logs && chmod 755 data && pm2 restart mizuki-blog` |
| `Error: D1 binding missing` / `env.DB is undefined` | 仍用 Cloudflare 分支的代码 | 确认 `git branch` 为 `main`，`src/db/client.ts` 为 `libsql` 版（`createClient({ url: "file:..." })`） |
| `sharp` 报错 `Cannot find module sharp` | 宝塔缺 `python/make/gcc` 编译环境 | Node版本管理器 → 切 `v22` 重装，或 `pnpm add sharp --ignore-scripts=false` |
| 静态 `_astro/*.css/js` 404 | 误用 `middleware` 模式 | 确认 `astro.config.mjs` 为 `node({ mode: "standalone" })`，重 `pnpm build` |
| `better-auth` 启动报 `secret must be at least 32 characters` | `BETTER_AUTH_SECRET` 未设或过短 | 终端 `openssl rand -base64 32` 重新生成，填入 PM2 环境变量后 `pm2 restart` |
| `GitHub OAuth 404 / redirect_uri_mismatch` | 回调 URL 未追加线上域名 | GitHub → OAuth App → **Authorization callback URL** 改为 `https://blog.example.com/api/auth/callback/github`（追加，原 localhost 可保留） |
| `pm2 logs` 报 `EACCES: permission denied, open './data/mizuki.db'` | `data/mizuki.db` 属 `root` | `chown www:www ./data/mizuki.db*` |
| `pnpm build` 报 `applyPolyfills` | 误装 `@astrojs/node@8+` 配 `astro@7.3` | 已在 `main` 固定 `@astrojs/node@7.0.4` 并 patch，`pnpm install --frozen-lockfile` 即可 |
| 访问 `https` 报证书错误 | 未申请 Let's Encrypt | 宝塔 → 网站 → SSL → Let's Encrypt → 申请 → 开启强制HTTPS |

---

## 10. 一键部署脚本（可选，适合重装）

保存为 `/www/wwwroot/deploy.sh`，`chmod +x deploy.sh` 后 `./deploy.sh`：

```bash
#!/bin/bash
set -e
APP_DIR="/www/wwwroot/blog.example.com"
REPO="https://github.com/sanjiu2024/mizuki-blog.git"
BRANCH="main"

if [ ! -d "$APP_DIR/.git" ]; then
  git clone -b $BRANCH $REPO $APP_DIR
fi
cd $APP_DIR
chown -R www:www $APP_DIR

sudo -u www git pull origin $BRANCH
sudo -u www pnpm install --frozen-lockfile
sudo -u www pnpm build
sudo -u www pnpm exec drizzle-kit push --force 2>/dev/null || true
chown -R www:www data logs 2>/dev/null || mkdir -p data logs && chown -R www:www data logs

pm2 delete mizuki-blog 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
echo "✅ 部署完成：curl -I http://127.0.0.1:4321"
curl -I http://127.0.0.1:4321 | head -n 1
```

---

## 11. 与 Cloudflare 版互切

| 方向 | 操作 |
|---|---|
| **宝塔 → Cloudflare** | `git checkout cloudflare` → `pnpm install` → 按 `docs/DEPLOYMENT_DASHBOARD.md` 配 `wrangler.jsonc` 的 `d1_databases/kv_namespaces` + Dashboard Variables → `pnpm build && wrangler deploy` |
| **Cloudflare → 宝塔** | `git checkout main` → 按本文 §3-§4 重建 `data/mizuki.db` → `pm2 start ecosystem.config.cjs` |

> `migrations/` 与 `src/db/schema.ts` 在两分支间完全复用，无需改动。

---

## 12. 附录：宝塔面板各按钮截图位置（文字版）

- **Node版本管理器**：软件商店 → 搜索 `Node版本管理器` → 安装 → 设置 → 安装新版本 `v22.12.0` → 切换命令行版本
- **Node项目**：网站 → 顶部 `Node项目` Tab → 添加Node项目 → 填表（见 §4 方式 A）
- **反向代理**：网站 → 点击 `blog.example.com` → 设置 → 反向代理 → 添加反向代理 → 目标 `http://127.0.0.1:4321`
- **SSL**：网站 → 点击 `blog.example.com` → 设置 → SSL → Let's Encrypt → 勾选域名 → 申请 → 开启强制HTTPS
- **文件管理器**：文件 → `/www/wwwroot/blog.example.com` → 上传/解压/右键权限
- **终端**：左侧 **终端** → 选 `www` 或 `root` 用户执行命令
- **安全**：安全 → 防火墙 → 添加 `80/443`

> 若找不到某按钮，宝塔顶部搜索框直接搜 `Node项目` / `反向代理` / `SSL` 即可。
