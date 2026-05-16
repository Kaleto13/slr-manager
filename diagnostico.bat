@echo off
echo Iniciando diagnostico... > "%~dp0diagnostico.txt"
echo Fecha: %date% %time% >> "%~dp0diagnostico.txt"
echo. >> "%~dp0diagnostico.txt"

echo === RUTA DEL BAT === >> "%~dp0diagnostico.txt"
echo %~dp0 >> "%~dp0diagnostico.txt"
echo. >> "%~dp0diagnostico.txt"

echo === PYTHON === >> "%~dp0diagnostico.txt"
python --version >> "%~dp0diagnostico.txt" 2>&1
echo. >> "%~dp0diagnostico.txt"

echo === UVICORN === >> "%~dp0diagnostico.txt"
python -m uvicorn --version >> "%~dp0diagnostico.txt" 2>&1
echo. >> "%~dp0diagnostico.txt"

echo === NPM === >> "%~dp0diagnostico.txt"
npm --version >> "%~dp0diagnostico.txt" 2>&1
echo. >> "%~dp0diagnostico.txt"

echo === ARCHIVOS DEL PROYECTO === >> "%~dp0diagnostico.txt"
if exist "%~dp0backend\main.py" (echo backend\main.py OK) else (echo backend\main.py NO ENCONTRADO) >> "%~dp0diagnostico.txt"
if exist "%~dp0backend\.env" (echo backend\.env OK) else (echo backend\.env NO ENCONTRADO) >> "%~dp0diagnostico.txt"
if exist "%~dp0frontend\package.json" (echo frontend\package.json OK) else (echo frontend\package.json NO ENCONTRADO) >> "%~dp0diagnostico.txt"
if exist "%~dp0scripts\backend.bat" (echo scripts\backend.bat OK) else (echo scripts\backend.bat NO ENCONTRADO) >> "%~dp0diagnostico.txt"
if exist "%~dp0scripts\frontend.bat" (echo scripts\frontend.bat OK) else (echo scripts\frontend.bat NO ENCONTRADO) >> "%~dp0diagnostico.txt"

echo. >> "%~dp0diagnostico.txt"
echo === FIN DIAGNOSTICO === >> "%~dp0diagnostico.txt"

echo Listo. Abre el archivo diagnostico.txt en esta carpeta.
pause
