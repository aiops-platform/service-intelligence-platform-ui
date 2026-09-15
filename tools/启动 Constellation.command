#!/bin/bash
# 双击我就能打开离线的 Constellation 页面。
#
# macOS 会把 .command 文件丢进终端执行，所以这等价于「双击启动」。
# 关闭终端窗口 = 停止服务。
#
# 为什么不能直接双击 html：
#   1) turbopack 运行时把懒加载 chunk 拼成从根算起的 "/_next/…"，
#      file:// 下会落到文件系统根，必然 404
#   2) Chrome 保存的那份 html 是 DOM 快照，React 根本不会启动
#   所以必须起本地服务，且服务根目录 = 仓库的 public/

cd "$(dirname "$0")" || exit 1

if [[ ! -f ../public/constellation-app.html ]]; then
  clear
  echo "================================================"
  echo "  离线副本还没构建"
  echo "================================================"
  echo
  echo "请先在终端里跑一次："
  echo "    cd $(pwd)"
  echo "    python3 make-offline-page.py"
  echo
  echo "（默认不联网，用的是 vendor/ 里的缓存）"
  echo
  read -n 1 -s -r -p "按任意键关闭…"
  exit 1
fi

exec ./start-offline.sh
