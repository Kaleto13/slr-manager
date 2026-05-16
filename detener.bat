@echo off
chcp 65001 >nul
title SLR Manager — Detener
echo Cerrando procesos de SLR Manager...

:: Detener uvicorn (backend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    echo   Deteniendo backend en puerto 8000 (PID %%a)
    taskkill /PID %%a /F >nul 2>&1
)

:: Detener Vite (frontend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    echo   Deteniendo frontend en puerto 5173 (PID %%a)
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo Aplicacion detenida.
pause
