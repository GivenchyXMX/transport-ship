#!/usr/bin/env bash
set -euo pipefail

root="${1:?缺少部署目录}"
stage="${2:?缺少临时目录}"
[[ -d "$root/.runtime" && -f "$root/deploy/config.env" && -f "$stage/server/server.js" ]] || {
  echo "线上目录或上传文件不完整" >&2; exit 1;
}
cd "$root"
node "$stage/scripts/build-game.cjs" --check
node --check "$stage/server/server.js"
[[ ! -e "$stage/deploy/config.env" && ! -e "$stage/.runtime" ]] || {
  echo "临时目录包含运行数据或配置，拒绝覆盖" >&2; exit 1;
}

backup_dir="$(dirname "$root")/$(basename "$root")-backups"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
umask 077
backup="$backup_dir/$(basename "$root")-$(date +%Y%m%d-%H%M%S).tar.gz"

recover() {
  code=$?
  trap - ERR
  set +e
  echo "部署失败，尝试恢复旧版本…" >&2
  if [[ -s "$backup" ]]; then
    ./deploy/stop.sh
    tar -xzf "$backup" -C "$(dirname "$root")"
    ./deploy/install.sh
  fi
  ./deploy/start.sh
  exit "$code"
}
trap recover ERR

./deploy/stop.sh
tar -czf "$backup" --exclude="$(basename "$root")/server/node_modules" \
  --exclude="$(basename "$root")/.runtime/node" -C "$(dirname "$root")" "$(basename "$root")"
tar -tzf "$backup" | grep -Fx "$(basename "$root")/deploy/config.env" >/dev/null
tar -tzf "$backup" | grep -Fx "$(basename "$root")/.runtime/accounts.sqlite" >/dev/null
echo "备份：$backup"

cp -a "$stage"/. "$root"/
./deploy/install.sh
node scripts/build-game.cjs --check
./deploy/start.sh
./deploy/status.sh
source deploy/common.sh
load_config
curl -fsS "http://127.0.0.1:${PORT:-8787}/health" >/dev/null
curl -fsS "http://127.0.0.1:${PORT:-8787}/transport-ship-mp.html" >/dev/null
curl -fsS "http://127.0.0.1:${PORT:-8787}/web/game.js" >/dev/null
trap - ERR
find "$backup_dir" -maxdepth 1 -type f -name "$(basename "$root")-*.tar.gz" \
  ! -name "$(basename "$backup")" -delete
echo "远程健康检查通过，备份：$backup"
