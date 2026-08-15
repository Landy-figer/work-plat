@echo off
chcp 65001 >nul
setlocal
set "NODE=C:\Users\c_lan\.workbuddy\binaries\node\versions\22.22.2\node.exe"
set "PROJ=%~dp0"
set "PORT=8200"
rem 释放 8200 端口上任何旧进程（例如旧的 index.js），确保启动的是我们的 sync.js
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8200" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 >nul
if not exist "%PROJ%server\sync.js" (
  echo 找不到 %PROJ%server\sync.js，请确认本启动器位于项目目录内。
  pause
  exit /b 1
)
start "" "%NODE%" "%PROJ%server\sync.js"
timeout /t 2 >nul
start "" http://localhost:%PORT%
endlocal
