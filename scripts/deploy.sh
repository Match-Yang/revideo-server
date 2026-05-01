#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
APP_NAME="revideo-server"
SERVER_PORT=3001

echo "==> revideo-server deploy"

# 0. Ensure pm2
if ! command -v pm2 &>/dev/null; then
    echo "    pm2 not found, installing..."
    npm install -g pm2
fi

# 1. Stop old process
pm2 delete "$APP_NAME" 2>/dev/null && echo "    old process stopped" || echo "    no old process to stop"

# 2. Install dependencies & type check
echo "==> installing dependencies..."
npm install --production=false

# 3. Start with pm2
echo "==> starting server..."
pm2 start npx --name "$APP_NAME" -- tsx src/server.ts

# 4. Wait and verify
echo -n "    waiting for server"
for i in $(seq 1 30); do
    STATUS=$(pm2 jlist 2>/dev/null | node -e "
        const list = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
        const app = list.find(p => p.name === '$APP_NAME');
        console.log(app ? app.pm2_env.status : 'not_found');
    " 2>/dev/null || echo "errored")
    if [ "$STATUS" = "stopped" ] || [ "$STATUS" = "errored" ]; then
        echo ""
        echo "ERROR: server failed to start. Check logs:"
        pm2 logs "$APP_NAME" --lines 20 --nostream
        exit 1
    fi
    if curl -s -o /dev/null -w '' http://localhost:$SERVER_PORT/ 2>/dev/null; then
        echo ""
        echo "==> server is running (port $SERVER_PORT)"
        pm2 save
        echo ""
        echo "    logs:   pm2 logs $APP_NAME"
        echo "    status: pm2 status"
        echo "    stop:   pm2 stop $APP_NAME"
        exit 0
    fi
    echo -n "."
    sleep 1
done

echo ""
echo "WARNING: server started but not responding within 30s"
pm2 logs "$APP_NAME" --lines 20 --nostream
exit 1
