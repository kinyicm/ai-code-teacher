@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   AI 代码学习助手 - 启动中
echo ========================================
echo.
echo 启动完成后请在浏览器打开:
echo     http://localhost:3000
echo.
echo 关闭本窗口即停止服务器。
echo.
call npm run dev
pause