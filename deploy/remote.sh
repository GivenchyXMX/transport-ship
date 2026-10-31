#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${DEPLOY_SOURCE:-$ROOT_DIR}"
if [[ -f "$ROOT_DIR/deploy/remote.local.sh" ]]; then
  # 本机专用配置含服务器信息，不上传也不提交。
  source "$ROOT_DIR/deploy/remote.local.sh"
fi
TARGET="${DEPLOY_TARGET:-}"
REMOTE_DIR="${DEPLOY_PATH:-}"
[[ -n "$TARGET" && -n "$REMOTE_DIR" ]] || {
  echo "请先在 deploy/remote.local.sh 中配置 DEPLOY_TARGET 和 DEPLOY_PATH" >&2; exit 1;
}
[[ "$REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "DEPLOY_PATH 必须是普通绝对路径" >&2; exit 1; }
command -v ssh >/dev/null && command -v rsync >/dev/null || { echo "需要 ssh 和 rsync" >&2; exit 1; }

echo "部署目标：$TARGET:$REMOTE_DIR"
stage="$(ssh "$TARGET" "mktemp -d '$REMOTE_DIR.stage.XXXXXXXX'")"
[[ "$stage" == "$REMOTE_DIR.stage."* ]] || { echo "无法确认远程临时目录：$stage" >&2; exit 1; }
cleanup() { ssh "$TARGET" "rm -rf -- '$stage'" || true; }
trap cleanup EXIT

rsync -az --exclude='.git/' --exclude='.runtime/' --exclude='.idea/' \
  --exclude='server/node_modules/' --exclude='deploy/config.env' \
  --exclude='deploy/remote.local.sh' \
  "$SOURCE_DIR/" "$TARGET:$stage/"

ssh -tt "$TARGET" <<EOF
bash '$stage/deploy/remote-activate.sh' '$REMOTE_DIR' '$stage'
exit \$?
EOF
ssh "$TARGET" "cd '$REMOTE_DIR' && ./deploy/status.sh"
echo "部署完成：$TARGET:$REMOTE_DIR"
