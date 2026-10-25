#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

if [[ "$(uname -s)" != Linux ]]; then
  echo "此安装脚本用于 Linux 服务器；macOS/Windows 可按 README 手动安装 Node.js 24+。" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
if [[ ! -f "$ROOT_DIR/deploy/config.env" ]]; then
  cp "$ROOT_DIR/deploy/config.env.example" "$ROOT_DIR/deploy/config.env"
  echo "已创建 deploy/config.env，可在其中修改监听地址和端口。"
fi

install_download_tools() {
  local missing=0 tool
  for tool in curl tar sha256sum; do
    command -v "$tool" >/dev/null 2>&1 || missing=1
  done
  (( missing == 0 )) && return

  local root=()
  if (( EUID != 0 )); then
    command -v sudo >/dev/null 2>&1 || { echo "需要 sudo 安装 curl、tar、coreutils" >&2; exit 1; }
    root=(sudo)
  fi
  if command -v apt-get >/dev/null 2>&1; then
    "${root[@]}" apt-get update
    "${root[@]}" apt-get install -y ca-certificates curl tar coreutils
  elif command -v dnf >/dev/null 2>&1; then
    "${root[@]}" dnf install -y ca-certificates curl tar coreutils
  elif command -v yum >/dev/null 2>&1; then
    "${root[@]}" yum install -y ca-certificates curl tar coreutils
  else
    echo "请先安装 curl、tar 和 sha256sum（coreutils），再运行本脚本。" >&2
    exit 1
  fi
}

install_download_tools

if ! find_node; then
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "当前仅支持 Linux x86_64 / aarch64；请手动安装 Node.js 24+。" >&2; exit 1 ;;
  esac

  tmp="$(mktemp -d)"
  trap 'rm -rf -- "$tmp"' EXIT
  base='https://nodejs.org/dist/latest-v24.x'
  variant="linux-$arch"
  if [[ "$arch" == x64 ]] && command -v getconf >/dev/null 2>&1; then
    glibc="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')"
    if [[ -n "$glibc" ]] && [[ "$(printf '%s\n%s\n' "$glibc" '2.28' | sort -V | head -1)" != '2.28' ]]; then
      echo "检测到 glibc $glibc，使用社区维护的 glibc 2.17 兼容构建。"
      index="$(curl --fail --location --silent --show-error https://unofficial-builds.nodejs.org/download/release/index.tab)"
      version="$(printf '%s\n' "$index" | awk '$1 ~ /^v24[.]/ && $3 ~ /(^|,)linux-x64-glibc-217(,|$)/ { print $1; exit }')"
      [[ -n "$version" ]] || { echo "未找到 Node.js 24 的 glibc 2.17 兼容构建" >&2; exit 1; }
      base="https://unofficial-builds.nodejs.org/download/release/$version"
      variant='linux-x64-glibc-217'
    fi
  fi
  echo "正在获取 Node.js 24 发布包：$base"
  curl --fail --location --silent --show-error "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  archive="$(awk -v suffix="-$variant.tar.gz" '$2 ~ /^node-v24[.]/ && index($2,suffix) { print $2; exit }' "$tmp/SHASUMS256.txt")"
  [[ -n "$archive" ]] || { echo "未找到适合当前架构的 Node.js 发布包" >&2; exit 1; }
  curl --fail --location --silent --show-error "$base/$archive" -o "$tmp/$archive"
  awk -v file="$archive" '$2 == file { print; exit }' "$tmp/SHASUMS256.txt" > "$tmp/selected.sha256"
  (cd "$tmp" && sha256sum --check selected.sha256)

  mkdir -p "$STATE_DIR/node-dist"
  tar -xzf "$tmp/$archive" -C "$STATE_DIR/node-dist"
  ln -sfn "node-dist/${archive%.tar.gz}" "$STATE_DIR/node"
  echo "已安装 $("$STATE_DIR/node/bin/node" --version) 到 $STATE_DIR/node"
fi

require_node
export PATH="$(dirname -- "$NODE_BIN"):$PATH"
command -v npm >/dev/null 2>&1 || { echo "Node.js 已找到，但缺少 npm" >&2; exit 1; }
echo "正在安装项目依赖…"
(cd "$ROOT_DIR/server" && npm ci --omit=dev --no-audit --no-fund)
echo "安装完成：$("$NODE_BIN" --version)，依赖位于 server/node_modules。"
echo "运行 ./deploy/start.sh 启动服务。"
