#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
load_config
require_node
[[ -d "$ROOT_DIR/server/node_modules/ws" ]] || { echo "依赖未安装，请先运行 ./deploy/install.sh" >&2; exit 1; }
[[ -d "$ROOT_DIR/server/node_modules/nodemailer" ]] || { echo "邮件依赖未安装，请先运行 ./deploy/install.sh" >&2; exit 1; }
mkdir -p "$STATE_DIR"

if [[ -f "$PID_FILE" ]]; then
  read -r old_pid < "$PID_FILE" || true
  if process_is_ours "${old_pid:-}"; then
    echo "服务已在运行，PID $old_pid"
    exit 0
  fi
  rm -f -- "$PID_FILE"
fi

cd "$ROOT_DIR/server"
nohup "$NODE_BIN" "$ROOT_DIR/server/server.js" >> "$LOG_FILE" 2>&1 < /dev/null &
pid=$!
printf '%s\n' "$pid" > "$PID_FILE"

health_host="$HOST"
[[ "$HOST" == '0.0.0.0' || "$HOST" == '::' ]] && health_host='127.0.0.1'
for _ in {1..20}; do
  # nohup may not have exec'd node when the first check runs, so check
  # liveness first and verify the command only after HTTP is ready.
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  if command -v curl >/dev/null 2>&1 && curl --fail --silent --max-time 1 "http://$health_host:$PORT/health" >/dev/null && process_is_ours "$pid"; then
    echo "服务已在后台启动，PID $pid"
    echo "地址：http://$health_host:$PORT/"
    echo "日志：$LOG_FILE"
    exit 0
  fi
  sleep 0.5
done

rm -f -- "$PID_FILE"
echo "启动失败，最近日志：" >&2
tail -n 20 "$LOG_FILE" >&2
exit 1
