#!/bin/bash
set -euo pipefail
# Mizuki Blog 一键更新脚本（生产级）
# 适用：宝塔 Node + libsql（file:./data/mizuki.db）+ PM2 + Nginx
# 特性：备份→依赖智能安装→构建→迁移→重载→健康检查→失败回滚 + 演练模式
# 用法：
#   ./update.sh                 正常更新（增量，推荐日常）
#   ./update.sh --dry-run       演练：只回显，不执行
#   ./update.sh --force         强制：重装依赖 + 重跑迁移
#   ./update.sh --skip-build    跳过构建（仅重启，极速）
#   ./update.sh -h|--help       帮助

APP_DIR="/www/wwwroot/mizuki-blog"
APP_NAME="mizuki-blog"
HEALTH_URL="http://127.0.0.1:4321"
HEALTH_RETRY=12
HEALTH_INTERVAL=2
LOG_DIR="logs"
BACKUP_DIR="data/backup"

DRY_RUN=0
FORCE=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)
      echo "用法: $0 [--dry-run] [--force] [--skip-build]"
      echo "  无参数      备份→拉代码→按需 pnpm install→构建→按需迁移→pm2 reload→健康检查"
      echo "  --dry-run   演练模式，只打印命令"
      echo "  --force     强制重装依赖并重跑 drizzle-kit push"
      echo "  --skip-build 跳过 pnpm build（仅重启）"
      exit 0
      ;;
    *) echo "未知参数: $arg  (试 $0 --help)" >&2; exit 1 ;;
  esac
done

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] $*"
  else
    echo "==> $*"
    eval "$*"
  fi
}

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_DIR/update.log" 2>/dev/null || echo "$*"; }

# 进入应用目录
if [[ -d "$APP_DIR" ]]; then
  cd "$APP_DIR"
else
  cd "$(dirname "$0")"
  APP_DIR="$(pwd)"
fi
mkdir -p "$LOG_DIR" "$BACKUP_DIR" data 2>/dev/null || true

log "开始更新：$APP_DIR (force=$FORCE, dry_run=$DRY_RUN, skip_build=$SKIP_BUILD)"

# 1. 备份数据库（失败不阻断）
if [[ -f "data/mizuki.db" ]]; then
  BK="$BACKUP_DIR/mizuki.db.$(date +%Y%m%d_%H%M%S).bak"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] cp data/mizuki.db $BK"
  else
    cp data/mizuki.db "$BK" 2>/dev/null && log "已备份 $BK" || log "备份跳过"
    ls -t "$BACKUP_DIR"/mizuki.db.* 2>/dev/null | tail -n +21 | xargs -r rm -f 2>/dev/null || true
  fi
fi

# 2. 拉代码（记录变更文件，用于智能判断）
CHANGED=""
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] git pull origin main"
else
  log "git pull origin main"
  BEFORE="$(git rev-parse HEAD 2>/dev/null || echo "")"
  git pull origin main 2>&1 | tee -a "$LOG_DIR/update.log" || { log "git pull 失败"; exit 1; }
  AFTER="$(git rev-parse HEAD 2>/dev/null || echo "")"
  if [[ -n "$BEFORE" && -n "$AFTER" && "$BEFORE" != "$AFTER" ]]; then
    CHANGED="$(git diff --name-only "$BEFORE" "$AFTER" 2>/dev/null || echo "")"
    log "变更文件：$(echo "$CHANGED" | tr '\n' ' ')"
  fi
fi

# 3. 依赖：lock 或 package.json 变更或 --force 时重装
NEED_INSTALL=0
if [[ "$FORCE" == "1" ]]; then NEED_INSTALL=1
elif echo "$CHANGED" | grep -qE "package\.json|pnpm-lock\.yaml"; then NEED_INSTALL=1
fi
if [[ "$NEED_INSTALL" == "1" ]]; then
  run "pnpm install --frozen-lockfile"
else
  log "依赖未变更，跳过 pnpm install（加 --force 可强制）"
fi

# 4. 构建
if [[ "$SKIP_BUILD" == "1" ]]; then
  log "跳过构建 (--skip-build)"
else
  run "pnpm build"
fi

# 5. 迁移：migrations 或 schema 变更或 --force 时 push
NEED_MIGRATE=0
if [[ "$FORCE" == "1" ]]; then NEED_MIGRATE=1
elif echo "$CHANGED" | grep -qE "migrations/|src/db/schema|drizzle\.config"; then NEED_MIGRATE=1
fi
if [[ "$NEED_MIGRATE" == "1" ]]; then
  run "pnpm exec drizzle-kit push --force 2>/dev/null || pnpm exec drizzle-kit push"
  run "chown -R www:www data 2>/dev/null || true"
else
  log "表结构未变更，跳过 drizzle-kit push"
fi
run "mkdir -p data logs && chown -R www:www data logs 2>/dev/null || true"

# 6. 重载 PM2（优先 reload 零停机，失败降级 restart/start）
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] pm2 reload $APP_NAME || pm2 restart $APP_NAME || pm2 start ecosystem.config.cjs --env production"
else
  log "pm2 reload $APP_NAME"
  if pm2 reload "$APP_NAME" 2>&1 | tee -a "$LOG_DIR/update.log"; then
    log "pm2 reload 成功"
  elif pm2 restart "$APP_NAME" 2>&1 | tee -a "$LOG_DIR/update.log"; then
    log "pm2 restart 成功"
  else
    log "pm2 启动 ecosystem.config.cjs"
    pm2 start ecosystem.config.cjs --env production 2>&1 | tee -a "$LOG_DIR/update.log"
  fi
  pm2 save 2>&1 | tee -a "$LOG_DIR/update.log" || true
fi

# 7. 健康检查（带重试，失败自动回滚）
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] curl -I $HEALTH_URL (retry $HEALTH_RETRY x ${HEALTH_INTERVAL}s)"
else
  log "健康检查 $HEALTH_URL"
  ok=0
  for i in $(seq 1 $HEALTH_RETRY); do
    if curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null | grep -q "200"; then
      ok=1; log "健康检查通过 (200)"; break
    fi
    sleep "$HEALTH_INTERVAL"
  done
  if [[ "$ok" != "1" ]]; then
    log "健康检查失败，尝试回滚上一次备份"
    LATEST_BK="$(ls -t "$BACKUP_DIR"/mizuki.db.* 2>/dev/null | head -n 1 || echo "")"
    if [[ -n "$LATEST_BK" && -f "$LATEST_BK" ]]; then
      cp "$LATEST_BK" data/mizuki.db 2>/dev/null && chown www:www data/mizuki.db 2>/dev/null || true
      pm2 restart "$APP_NAME" 2>&1 | tee -a "$LOG_DIR/update.log" || true
      log "已回滚 $LATEST_BK，请检查 pm2 logs $APP_NAME --lines 50"
    fi
    log "更新失败，请查看 logs/update.log 与 pm2 logs"
    exit 1
  fi
fi

log "更新完成 ✅  访问：curl -I $HEALTH_URL"
if [[ "$DRY_RUN" != "1" ]]; then
  curl -I "$HEALTH_URL" 2>&1 | head -n 5 | tee -a "$LOG_DIR/update.log" || true
fi
