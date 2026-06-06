#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${REVIDEO_PORT:-3001}"
LOG_FILE="${REVIDEO_UI_LOG:-/tmp/revideo-ui.log}"
PID_FILE="${REVIDEO_UI_PID:-/tmp/revideo-ui.pid}"
LABEL="${REVIDEO_UI_LABEL:-local.revideo.ui}"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
NODE_BIN="${REVIDEO_NODE_BIN:-$(command -v node)}"

echo "[restart-ui] stopping listeners on port ${PORT}"
if command -v launchctl >/dev/null 2>&1 && [[ "$(uname -s)" == "Darwin" ]]; then
  launchctl bootout "gui/$(id -u)" "${PLIST}" >/dev/null 2>&1 || true
fi

if [[ -f "${PID_FILE}" ]]; then
  OLD_PID="$(cat "${PID_FILE}" || true)"
  if [[ -n "${OLD_PID}" ]] && kill -0 "${OLD_PID}" >/dev/null 2>&1; then
    kill "${OLD_PID}" || true
  fi
  rm -f "${PID_FILE}"
fi

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
if command -v launchctl >/dev/null 2>&1 && [[ "$(uname -s)" == "Darwin" ]]; then
  mkdir -p "$(dirname "${PLIST}")"
  cat >"${PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd '${PWD}' &amp;&amp; exec '${NODE_BIN}' --import tsx src/server.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>REVIDEO_PORT</key>
    <string>${PORT}</string>
    <key>PATH</key>
    <string>${PATH}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${PWD}</string>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
EOF
  launchctl bootstrap "gui/$(id -u)" "${PLIST}"
  launchctl kickstart -k "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
else
  nohup bash -lc "cd '$PWD' && exec '${NODE_BIN}' --import tsx src/server.ts" >"${LOG_FILE}" 2>&1 </dev/null &
  echo "$!" >"${PID_FILE}"
fi

for _ in {1..20}; do
  if curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    echo "[restart-ui] ready: http://localhost:${PORT}"
    PIDS="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN || true)"
    if [[ -n "${PIDS}" ]]; then
      echo "${PIDS}" | head -n 1 >"${PID_FILE}"
      echo "[restart-ui] pid: $(cat "${PID_FILE}")"
    fi
    exit 0
  fi
  sleep 0.5
done

echo "[restart-ui] failed to start; recent log:"
tail -80 "${LOG_FILE}" || true
exit 1
