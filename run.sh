#!/usr/bin/env bash
# 启动 Macdows Explorer
set -e
cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE
unset NODE_OPTIONS
if [ ! -d node_modules/electron ]; then
  echo "正在安装依赖..."
  npm install
fi
node_modules/.bin/electron .
