#!/usr/bin/env bash
# 供部署脚本共用；从任意工作目录调用都定位到项目根目录。
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/.runtime"
PID_FILE="$STATE_DIR/server.pid"
LOG_FILE="$STATE_DIR/server.log"

load_config() {
  if [[ -f "$ROOT_DIR/deploy/config.env" ]]; then
    # config.env 是部署者在服务器上维护的可信 Shell 配置文件。
    # shellcheck disable=SC1091
    source "$ROOT_DIR/deploy/config.env"
  fi
  PORT="${PORT:-8787}"
  HOST="${HOST:-0.0.0.0}"
  if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
    echo "PORT 必须是 1–65535 的整数" >&2
    return 1
  fi
  RANK_XP_ENABLED="${RANK_XP_ENABLED:-1}"
  export PORT HOST SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM PUBLIC_ORIGIN AUTH_DB_PATH RANK_XP_ENABLED
}

find_node() {
  if [[ -x "$STATE_DIR/node/bin/node" ]]; then
    NODE_BIN="$STATE_DIR/node/bin/node"
  elif command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  else
    return 1
  fi
  local major
  major="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)" || return 1
  [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 24 ))
}

require_node() {
  if ! find_node; then
    echo "缺少 Node.js 24+；请先运行 ./deploy/install.sh" >&2
    return 1
  fi
}

process_is_ours() {
  local pid="$1" command_line
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  command_line="$(ps -p "$pid" -o args= 2>/dev/null)" || return 1
  [[ "$command_line" == *"$ROOT_DIR/server/server.js"* ]]
}
