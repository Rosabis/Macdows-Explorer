@echo off
:: 启动 Macdows Explorer（清除可能干扰 electron 的环境变量）
set ELECTRON_RUN_AS_NODE=
set NODE_OPTIONS=
cd /d "%~dp0"
if not exist node_modules\electron (
  echo 正在安装依赖...
  call npm.cmd install
)
node_modules\.bin\electron .
pause
