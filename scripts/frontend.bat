@echo off
title SLR - Frontend (puerto 5173)
cd /d "%~dp0..\frontend"

echo.
echo  Verificando node_modules...
if not exist "node_modules" (
    echo  node_modules no encontrado. Ejecutando npm install...
    npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] Fallo npm install.
        pause
        exit /b 1
    )
)

echo  Iniciando Frontend en http://localhost:5173
echo  Presiona Ctrl+C para detener.
echo.
npm run dev
pause
