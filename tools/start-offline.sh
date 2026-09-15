#!/usr/bin/env bash
# 起本地服务打开离线的 Constellation 页面。
#
# 为什么非要起服务、不能双击 html：
#   turbopack 运行时把懒加载 chunk 拼成 "/_next/static/chunks/…"（从根算起的绝对
#   路径，硬编码）。file:// 下它会落到文件系统根，必然 404。只有当服务根目录
#   正好是这个文件夹时，/_next/… 才对得上。
#
# 用法:  ./start-offline.sh [端口]

set -euo pipefail

PORT="${1:-8777}"
# 产物在仓库的 public/ —— 那里本来就是"按根伺服静态资源"的位置，
# Vite 跑 dev/build 时也是同一份，单独看与嵌进应用看的是同一个东西。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/public"
PAGE="constellation-app.html"

if [[ ! -f "$DIR/$PAGE" ]]; then
  echo "✗ 找不到 $DIR/$PAGE" >&2
  echo "  先跑:  python3 make-offline-page.py" >&2
  exit 1
fi

# 端口被占就换一个，省得对着 "Address already in use" 猜
if command -v lsof >/dev/null && lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "! 端口 $PORT 被占用，改用 $((PORT + 1))"
  PORT=$((PORT + 1))
fi

URL="http://localhost:$PORT/$PAGE"
echo "→ 服务根目录: $DIR"
echo "→ 打开:       $URL"
echo "   （Ctrl-C 停止）"
echo

# 打开浏览器（macOS）
command -v open >/dev/null && (sleep 1 && open "$URL") &

exec python3 -m http.server "$PORT" --directory "$DIR"
