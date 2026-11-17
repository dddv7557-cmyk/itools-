@echo off
rem iTools: local launch on this computer (no GitHub, no internet hosting).
rem Double-click this file. The app opens at http://localhost/ (port 80 is required by VK ID for local sign-in).
chcp 65001 >nul
cd /d "%~dp0"
title iTools

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите его с https://nodejs.org и запустите этот файл снова.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo Не удалось установить зависимости.
    pause
    exit /b 1
  )
)

echo Собираю iTools...
call npm run build
if errorlevel 1 (
  echo Сборка не удалась.
  pause
  exit /b 1
)

echo.
echo iTools запущен: http://localhost/
echo Не закрывайте это окно, пока пользуетесь приложением. Остановка: Ctrl+C.
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost/"
call npm run serve
if errorlevel 1 (
  echo.
  echo Не удалось занять порт 80. Возможно, его использует другая программа ^(Skype, IIS, другой сервер^).
  echo Закройте её и запустите файл снова.
  pause
)
