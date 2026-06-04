#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${REVIDEO_PORT:-3001}"
LOG_FILE="${REVIDEO_UI_LOG:-/tmp/revideo-ui.log}"

echo "[restart-ui] stopping listeners on port ${PORT}"
PIDS="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN || true)"
if [[ -n "${PIDS}" ]]; then
  # shellcheck disable=SC2086
  kill ${PIDS} || true
  sleep 1
fi

PIDS="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN || true)"
if [[ -n "${PIDS}" ]]; then
  echo "[restart-ui] force stopping: ${PIDS}"
  # shellcheck disable=SC2086
  kill -9 ${PIDS} || true
fi

echo "[restart-ui] starting server, log: ${LOG_FILE}"
nohup node --import tsx src/server.ts >"${LOG_FILE}" 2>&1 </dev/null &

for _ in {1..20}; do
  if curl -fsS "http://localhost:${PORT}/" >/dev/null 2>&1; then
    echo "[restart-ui] ready: http://localhost:${PORT}"
    exit 0
  fi
  sleep 0.5
done

echo "[restart-ui] failed to start; recent log:"
tail -80 "${LOG_FILE}" || true
exit 1
