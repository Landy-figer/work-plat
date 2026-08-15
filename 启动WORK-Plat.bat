@echo off
chcp 65001 >nul
setlocal
set "NODE=C:\Users\c_lan\.workbuddy\binaries\node\versions\22.22.2\node.exe"
set "ROOT=%~dp0"
rem 若同步服务已在 8200 端口运行则直接打开，否则启动它
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri http://localhost:8200/api/health -UseBasicParsing -TimeoutSec 1).StatusCode } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  start "" "%NODE%" "%ROOT%server\sync.js"
  timeout /t 2 >nul
)
start "" http://localhost:8200
endlocal
