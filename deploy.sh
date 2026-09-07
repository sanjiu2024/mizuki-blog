#!/bin/bash
set -e
APP_DIR="/www/wwwroot/mizuki-blog"
cd "$APP_DIR"
echo "== git pull =="
git pull origin main
echo "== pnpm install (postinstall 自动 patch applyPolyfills) =="
pnpm install --frozen-lockfile
echo "== pnpm build =="
pnpm build
mkdir -p data logs
chown -R www:www data logs 2>/dev/null || true
echo "== drizzle-kit push =="
pnpm exec drizzle-kit push --force 2>/dev/null || true
chown www:www data/mizuki.db* 2>/dev/null || true
echo "== pm2 restart =="
pm2 delete mizuki-blog 2>/dev/null || true
pm2 delete blog 2>/dev/null || true
pm2 delete entry 2>/dev/null || true
pm2 start ecosystem.config.cjs --env production
pm2 save
sleep 2
curl -I http://127.0.0.1:4321 2>&1 | head -n 5
echo "== done: https://vvvvvv.bigsb.cn =="
