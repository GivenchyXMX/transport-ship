#!/bin/bash
# =============================================================================
#  运输船 · 联机对战 启动器
#
#  用法：双击本文件（或终端里 ./启动联机.command）
#  停止：关掉这个终端窗口，或按 Ctrl+C
#
#  注意：服务器是「前台常驻」运行的，所以这个窗口不能关。
#        （如果把它放后台，对话/终端一结束进程就被系统回收，别人就连不上了）
# =============================================================================
cd "$(dirname "$0")" || exit 1

if [ -f deploy/config.env ]; then
  set -a
  # 本机配置由项目维护者提供。
  . ./deploy/config.env
  set +a
fi
PORT="${PORT:-8787}"

echo ""
echo "  运输船 · 联机对战"
echo "  ========================================================"

# --- 找 node ---
NODE=""
for c in node /usr/local/bin/node /opt/homebrew/bin/node "$HOME/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"; do
  if [ -x "$c" ] 2>/dev/null || command -v "$c" >/dev/null 2>&1; then
    NODE="$(command -v "$c" 2>/dev/null || echo "$c")"
    break
  fi
done

if [ -z "$NODE" ]; then
  echo "  ✗ 没找到 node。请先安装 Node.js: https://nodejs.org"
  echo ""
  read -r -p "  按回车关闭…"
  exit 1
fi
echo "  node  : $NODE"
if [ "$("$NODE" -p 'Number(process.versions.node.split(".")[0])')" -lt 24 ]; then
  echo "  ✗ 当前版本需要 Node.js 24 或更新版本"
  read -r -p "  按回车关闭…"
  exit 1
fi

# --- 依赖 ---
if [ ! -d "server/node_modules/ws" ] || [ ! -d "server/node_modules/nodemailer" ]; then
  echo "  首次运行，安装依赖…"
  (cd server && npm ci --no-audit --no-fund >/dev/null 2>&1)
fi

# --- 端口占用？ ---
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo ""
  echo "  ! 端口 $PORT 已被占用 —— 服务器大概率已经在跑了，直接用即可："
  echo "      http://localhost:$PORT/transport-ship-mp.html"
  echo ""
  echo "  若想重启，先执行：  lsof -ti tcp:$PORT | xargs kill"
  echo ""
  read -r -p "  按回车打开浏览器…"
  open "http://localhost:$PORT/transport-ship-mp.html"
  exit 0
fi

# --- 起服务（前台）---
echo ""
echo "  服务器已启动，窗口保持开着 = 服务在运行"
echo "  --------------------------------------------------------"
  echo "  本机玩     : http://localhost:$PORT/transport-ship-mp.html"
echo "  健康检查   : http://localhost:$PORT/health   （应显示 ok）"
echo "  测试台     : http://localhost:$PORT/web/testbed.html"
echo "  --------------------------------------------------------"
echo ""

# 稍等一下再开浏览器，确保端口已监听
( sleep 2; open "http://localhost:$PORT/transport-ship-mp.html" ) &

cd server && exec "$NODE" server.js
