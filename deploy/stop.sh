#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

if [[ ! -f "$PID_FILE" ]]; then
  echo "服务未由 deploy/start.sh 启动。"
  exit 0
fi
read -r pid < "$PID_FILE" || true
if ! process_is_ours "${pid:-}"; then
  rm -f -- "$PID_FILE"
  echo "已清理失效 PID 文件；未停止其他进程。"
  exit 0
fi

kill -TERM "$pid"
for _ in {1..20}; do
  if ! process_is_ours "$pid"; then
    rm -f -- "$PID_FILE"
    echo "服务已停止，PID $pid"
    exit 0
  fi
  sleep 0.5
done
echo "PID $pid 尚未退出，请查看 $LOG_FILE" >&2
exit 1
