#!/bin/bash
set -e
# 轻量更新脚本（宝塔 / Node + libsql 适用）
# 用途：快速更新内容，无需重装依赖、无需改表结构时使用
# 与 deploy.sh 的区别：跳过 pnpm install 与 drizzle-kit push，只做 拉代码 -> 构建 -> 重载
# 用法：
#   ./update.sh              正常更新
#   ./update.sh --dry-run    只回显命令，不真正执行（演练模式）
#   ./update.sh -h|--help    显示帮助

# 应用目录（与 deploy.sh 保持一致）
APP_DIR="/www/wwwroot/mizuki-blog"
# PM2 进程名（与 deploy.sh / ecosystem.config.cjs 保持一致）
APP_NAME="mizuki-blog"

# 是否为演练模式
DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
elif [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "用法: $0 [--dry-run]"
  echo "  无参数    拉取 main 分支 -> pnpm build -> pm2 reload"
  echo "  --dry-run 只打印将要执行的命令，不真正执行"
  exit 0
fi

# 统一执行函数：演练模式只回显，正常模式真正执行
run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] $*"
  else
    echo "== $* =="
    eval "$*"
  fi
}

# 进入应用目录（本地开发时若宝塔目录不存在，则用脚本所在目录）
if [[ -d "$APP_DIR" ]]; then
  cd "$APP_DIR"
else
  # 回退到脚本所在目录，方便本地测试 --dry-run
  cd "$(dirname "$0")"
fi

# 第一步：拉取最新代码（固定 main 分支）
run "git pull origin main"

# 第二步：构建（不做 pnpm install，依赖不变时更快）
run "pnpm build"

# 第三步：保证数据/日志目录权限正确
run "mkdir -p data logs"
run "chown -R www:www data logs 2>/dev/null || true"

# 第四步：重载 PM2（reload 零停机；若进程不存在则自动降级为 restart/start）
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] pm2 reload $APP_NAME || pm2 restart $APP_NAME"
else
  echo "== pm2 reload =="
  pm2 reload "$APP_NAME" 2>/dev/null || pm2 restart "$APP_NAME" 2>/dev/null || pm2 start ecosystem.config.cjs --env production
  pm2 save
fi

# 第五步：健康检查（本机 4321 端口）
run "curl -I http://127.0.0.1:4321 2>&1 | head -n 5"

echo "== 更新完成 =="
