#!/bin/bash
set -euo pipefail
# Mizuki Blog 一键部署脚本（全量，首次/重装）
# 与 update.sh 区别：全量重装依赖 + 全量迁移，适合首次部署或 --force
# 用法： ./deploy.sh [--dry-run] [--force]

APP_DIR="/www/wwwroot/mizuki-blog"
APP_NAME="mizuki-blog"
HEALTH_URL="http://127.0.0.1:4321"
LOG_DIR="logs"
BACKUP_DIR="data/backup"

DRY_RUN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    -h|--help) echo "用法: $0 [--dry-run] [--force]"; echo "  --dry-run 演练"; echo "  --force  强制"; exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done

run() { if [[ "$DRY_RUN" == "1" ]]; then echo "[dry-run] $*"; else echo "==> $*"; eval "$*"; fi; }
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_DIR/deploy.log" 2>/dev/null || echo "$*"; }

if [[ -d "$APP_DIR" ]]; then cd "$APP_DIR"; else cd "$(dirname "$0")"; APP_DIR="$(pwd)"; fi
mkdir -p "$LOG_DIR" "$BACKUP_DIR" data 2>/dev/null || true
log "开始部署：$APP_DIR"

# 备份
if [[ -f "data/mizuki.db" ]]; then
  BK="$BACKUP_DIR/mizuki.db.$(date +%Y%m%d_%H%M%S).bak"
  if [[ "$DRY_RUN" == "1" ]]; then echo "[dry-run] cp data/mizuki.db $BK"; else cp data/mizuki.db "$BK" 2>/dev/null && log "已备份 $BK" || true; fi
fi

# 拉代码
if [[ "$DRY_RUN" == "1" ]]; then echo "[dry-run] git pull origin main"; else log "git pull"; git pull origin main 2>&1 | tee -a "$LOG_DIR/deploy.log" || { log "git pull 失败"; exit 1; }; fi

# 依赖（全量）
run "pnpm install --frozen-lockfile"

# 构建
run "pnpm build"

# 权限
run "mkdir -p data logs && chown -R www:www data logs 2>/dev/null || true"

# 迁移（全量）
run "pnpm exec drizzle-kit push --force 2>/dev/null || pnpm exec drizzle-kit push"
run "chown www:www data/mizuki.db* 2>/dev/null || true"

# PM2（清理旧进程，二选一）
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] pm2 delete $APP_NAME; pm2 start ecosystem.config.cjs --env production"
else
  pm2 delete "$APP_NAME" 2>/dev/null || true
  pm2 delete blog 2>/dev/null || true
  pm2 delete entry 2>/dev/null || true
  log "pm2 start $APP_NAME"
  pm2 start ecosystem.config.cjs --env production 2>&1 | tee -a "$LOG_DIR/deploy.log"
  pm2 save 2>&1 | tee -a "$LOG_DIR/deploy.log" || true
fi

# 健康检查
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] curl -I $HEALTH_URL"
else
  log "健康检查 $HEALTH_URL"
  ok=0; for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null | grep -q "200" && { ok=1; log "健康检查 200"; break; }; sleep 2; done
  if [[ "$ok" != "1" ]]; then log "健康检查失败，查看 pm2 logs $APP_NAME --lines 50"; exit 1; fi
  curl -I "$HEALTH_URL" 2>&1 | head -n 5 | tee -a "$LOG_DIR/deploy.log" || true
fi

log "部署完成 ✅  https://vvvvvv.bigsb.cn"
