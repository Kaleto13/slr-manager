@echo off
title SLR - Backend (puerto 8000)
cd /d "%~dp0..\backend"

echo.
echo  Verificando dependencias...
python -m uvicorn --version >nul 2>&1
if errorlevel 1 (
    echo  uvicorn no encontrado. Instalando requirements.txt...
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo [ERROR] Fallo la instalacion de dependencias.
        pause
        exit /b 1
    )
)

echo  Iniciando Backend en http://localhost:8000
echo  API Docs en http://localhost:8000/docs
echo  Presiona Ctrl+C para detener.
echo.
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
pause
