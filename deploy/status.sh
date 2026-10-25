#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
load_config

if [[ ! -f "$PID_FILE" ]]; then echo "服务未运行（没有 PID 文件）"; exit 1; fi
read -r pid < "$PID_FILE" || true
if ! process_is_ours "${pid:-}"; then echo "服务未运行（PID 文件已失效）"; exit 1; fi
echo "进程运行中，PID ${pid}，监听 $HOST:$PORT"
if command -v curl >/dev/null 2>&1; then
  health_host="$HOST"
  [[ "$HOST" == '0.0.0.0' || "$HOST" == '::' ]] && health_host='127.0.0.1'
  curl --fail --silent --show-error --max-time 2 "http://$health_host:$PORT/health"
  echo
fi
