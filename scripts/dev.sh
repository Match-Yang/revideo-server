#!/usr/bin/env bash
# Start the development servers (API + dashboard hot reload) in the foreground.
#
# Before launching, this script guarantees a clean port by:
#   1. unloading any revideo launchd services (local.revideo.ui + com.revideo.server)
#   2. killing whatever still holds the API/UI ports
#
# Usage: bash scripts/dev.sh
set -euo pipefail

cd "$(dirname "$0")/.."

API_PORT="${REVIDEO_PORT:-6688}"
UI_PORT=3000
UID_NUM="$(id -u)"

# ---------------------------------------------------------------------------
# 1. Unload launchd services that might hold the ports (macOS only)
# ---------------------------------------------------------------------------
if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
  for label in "local.revideo.ui" "com.revideo.server"; do
    plist="$HOME/Library/LaunchAgents/${label}.plist"
    if launchctl print "gui/${UID_NUM}/${label}" >/dev/null 2>&1; then
      echo "[dev] unloading launchd service: ${label}"
      launchctl bootout "gui/${UID_NUM}/${label}" >/dev/null 2>&1 || true
    fi
    rm -f "$plist"
  done
fi

# ---------------------------------------------------------------------------
# 2. Kill any process still holding the ports
# ---------------------------------------------------------------------------
echo "[dev] killing processes on ports ${API_PORT} and ${UI_PORT}..."
lsof -ti:"${API_PORT},${UI_PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 0.5

# ---------------------------------------------------------------------------
# 3. Start dev servers in the foreground (Ctrl-C to stop)
# ---------------------------------------------------------------------------
echo "[dev] starting dev servers (API :${API_PORT} + dashboard :${UI_PORT})..."
exec npm run dev
