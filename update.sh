#!/bin/bash
set -euo pipefail
# Mizuki Blog 真·一键更新（宝塔 Node + libsql）
# 每次全量：重装依赖+重建表+重启，无需判断，失败自动回滚
# 用法： ./update.sh  或  bash update.sh
#        ./update.sh --dry-run  演练

APP_DIR="/www/wwwroot/mizuki-blog"
APP_NAME="mizuki-blog"
HEALTH_URL="http://127.0.0.1:4321"
LOG_DIR="logs"
BACKUP_DIR="data/backup"

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; fi
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "用法: ./update.sh [--dry-run]"; echo "  直接 ./update.sh 一键全量更新"; exit 0
fi

run() { if [[ "$DRY_RUN" == "1" ]]; then echo "[dry-run] $*"; else echo "==> $*"; eval "$*"; fi; }
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_DIR/update.log" 2>/dev/null || echo "$*"; }

if [[ -d "$APP_DIR" ]]; then cd "$APP_DIR"; else cd "$(dirname "$0")"; APP_DIR="$(pwd)"; fi
mkdir -p "$LOG_DIR" "$BACKUP_DIR" data 2>/dev/null || true
log "开始一键更新：$APP_DIR"

if [[ -f "data/mizuki.db" ]]; then
  BK="$BACKUP_DIR/mizuki.db.$(date +%Y%m%d_%H%M%S).bak"
  if [[ "$DRY_RUN" == "1" ]]; then echo "[dry-run] cp data/mizuki.db $BK"; else cp data/mizuki.db "$BK" 2>/dev/null && log "已备份 $BK" || true; fi
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] git pull origin main"
  echo "[dry-run] pnpm install --frozen-lockfile"
  echo "[dry-run] pnpm build"
  echo "[dry-run] pnpm exec drizzle-kit push --force"
else
  log "git pull origin main"
  git pull origin main 2>&1 | tee -a "$LOG_DIR/update.log" || { log "git pull 失败"; exit 1; }
  log "pnpm install"
  pnpm install --frozen-lockfile 2>&1 | tee -a "$LOG_DIR/update.log"
  log "pnpm build"
  pnpm build 2>&1 | tee -a "$LOG_DIR/update.log"
  log "drizzle-kit push --force"
  pnpm exec drizzle-kit push --force 2>&1 | tee -a "$LOG_DIR/update.log" || pnpm exec drizzle-kit push 2>&1 | tee -a "$LOG_DIR/update.log" || true
  chown -R www:www data 2>/dev/null || true
fi
run "mkdir -p data logs && chown -R www:www data logs 2>/dev/null || true"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] pm2 reload $APP_NAME || pm2 restart $APP_NAME || pm2 start ecosystem.config.cjs --env production"
else
  log "pm2 reload $APP_NAME"
  pm2 reload "$APP_NAME" 2>&1 | tee -a "$LOG_DIR/update.log" || pm2 restart "$APP_NAME" 2>&1 | tee -a "$LOG_DIR/update.log" || pm2 start ecosystem.config.cjs --env production 2>&1 | tee -a "$LOG_DIR/update.log"
  pm2 save 2>&1 | tee -a "$LOG_DIR/update.log" || true
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] curl -I $HEALTH_URL"
else
  log "健康检查 $HEALTH_URL"
  ok=0; for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null | grep -q "200" && { ok=1; log "健康检查 200"; break; }; sleep 2; done
  if [[ "$ok" != "1" ]]; then
    log "健康检查失败，查看 pm2 logs $APP_NAME --lines 50"
    LATEST_BK="$(ls -t "$BACKUP_DIR"/mizuki.db.* 2>/dev/null | head -n 1 || echo "")"
    if [[ -n "$LATEST_BK" && -f "$LATEST_BK" ]]; then
      cp "$LATEST_BK" data/mizuki.db 2>/dev/null && chown www:www data/mizuki.db 2>/dev/null || true
      pm2 restart "$APP_NAME" 2>&1 | tee -a "$LOG_DIR/update.log" || true
      log "已回滚 $LATEST_BK"
    fi
    exit 1
  fi
  curl -I "$HEALTH_URL" 2>&1 | head -n 5 | tee -a "$LOG_DIR/update.log" || true
fi

log "一键更新完成 ✅  https://vvvvvv.bigsb.cn"
