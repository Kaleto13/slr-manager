"""
generar_bats.py — Genera los archivos .bat necesarios para SLR Manager.

Ejecutar una vez después de clonar el repositorio (o cuando quieras
regenerar los accesos directos):

    python generar_bats.py

Crea (o sobreescribe) en la misma carpeta:
    instalar.bat  — Asistente de primera instalación
    start.bat     — Lanzador de la aplicación
    detener.bat   — Cierra los procesos de backend y frontend
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent


# ── Contenido de cada .bat ──────────────────────────────────────────────────

INSTALAR_BAT = """\
@echo off
chcp 65001 >nul
title SLR Manager — Instalador
python "%~dp0instalar.py"
pause
"""

START_BAT = """\
@echo off
chcp 65001 >nul
title SLR Manager — Launcher
python "%~dp0start.py"
"""

DETENER_BAT = """\
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
"""


# ── Generador ───────────────────────────────────────────────────────────────

BATS = {
    "instalar.bat": INSTALAR_BAT,
    "start.bat":    START_BAT,
    "detener.bat":  DETENER_BAT,
}


def main():
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║       SLR Manager — Generador de archivos .bat      ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()

    for filename, content in BATS.items():
        path = ROOT / filename
        path.write_text(content, encoding="utf-8")
        print(f"  [OK] {filename} creado/actualizado")

    print()
    print("  Archivos generados:")
    print("    instalar.bat  → Ejecuta el asistente de instalación")
    print("    start.bat     → Inicia backend y frontend")
    print("    detener.bat   → Detiene la aplicación")
    print()
    print("  ¿Instalando por primera vez?")
    print("    1. Completa backend/.env con tu contraseña de PostgreSQL")
    print("    2. Haz doble clic en  instalar.bat")
    print("    3. Luego  start.bat  para iniciar la aplicación")
    print()
    input("Presiona Enter para cerrar...")


if __name__ == "__main__":
    main()
