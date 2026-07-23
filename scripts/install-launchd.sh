#!/usr/bin/env bash
# Install revideo-server as a launchd service that starts on boot.
#
# Usage: bash scripts/install-launchd.sh
set -euo pipefail

cd "$(dirname "$0")/.."

INSTALL_DIR="$(pwd)"
HOME_DIR="$HOME"
NODE_BIN="$(which node)"
NODE_VER="$(node --version)"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
PLIST_SRC="scripts/launchd/com.revideo.server.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.revideo.server.plist"
LABEL="com.revideo.server"

echo "=== revideo-server launchd installer ==="
echo ""
echo "  Install dir : $INSTALL_DIR"
echo "  Node binary : $NODE_BIN"
echo "  Node version: $NODE_VER"
echo "  NVM dir     : $NVM_DIR"
echo "  Home        : $HOME_DIR"
echo ""

# 1. Build TypeScript (launchd runs compiled JS)
echo "[1/4] Building TypeScript..."
npm run build

# 2. Ensure data directory exists (for log files)
echo "[2/4] Creating data directory..."
mkdir -p data

# 3. Generate plist from template
echo "[3/4] Generating launchd plist..."
sed \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  -e "s|__NVM_DIR__|$NVM_DIR|g" \
  -e "s|__NODE_VER__|$NODE_VER|g" \
  -e "s|__HOME__|$HOME_DIR|g" \
  -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
  "$PLIST_SRC" > "$PLIST_DST"

echo "  → written to $PLIST_DST"

# 4. Unload any existing instance, then load
echo "[4/4] Loading launchd service..."
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo ""
echo "✓ Done! revideo-server will start automatically on boot."
echo ""
echo "  Status : launchctl print gui/$(id -u)/$LABEL"
echo "  Logs   : tail -f data/server.log"
echo "  Stop   : launchctl bootout gui/$(id -u)/$LABEL"
echo "  Start  : launchctl bootstrap gui/$(id -u) $PLIST_DST"
echo "  Restart: launchctl kickstart -k gui/$(id -u)/$LABEL"
