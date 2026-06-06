#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

API_PORT="${REVIDEO_PORT:-3001}"
UI_PORT=3000

echo "[dev] killing processes on ports ${API_PORT} and ${UI_PORT}..."
lsof -ti:"${API_PORT},${UI_PORT}" | xargs kill -9 2>/dev/null || true
sleep 0.5

echo "[dev] starting dev servers..."
exec npm run dev
