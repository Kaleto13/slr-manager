"""
SLR Manager — Asistente de instalación (primera vez)
Ejecutar con: python instalar.py   o   doble clic en instalar.bat

Qué hace este script:
  1. Verifica Python 3.10+
  2. Verifica Node.js 18+
  3. Verifica PostgreSQL 17 instalado
  4. Instala paquetes Python del backend
  5. Instala paquetes Node del frontend
  6. Crea backend/.env con la configuración básica
  7. Crea las carpetas necesarias (data/PDFs)
  8. Informa al usuario que puede usar start.bat para iniciar
"""

import sys
import subprocess
import socket
import os
import time
from pathlib import Path

ROOT     = Path(__file__).resolve().parent
BACKEND  = ROOT / "backend"
FRONTEND = ROOT / "frontend"

# ── colores para la consola de Windows ─────────────────────────────────────
def _enable_ansi():
    """Activa colores ANSI en Windows 10+."""
    try:
        import ctypes
        kernel = ctypes.windll.kernel32
        kernel.SetConsoleMode(kernel.GetStdHandle(-11), 7)
    except Exception:
        pass

_enable_ansi()
OK   = "\033[92m[OK]\033[0m"
ERR  = "\033[91m[ERROR]\033[0m"
INFO = "\033[94m[...]\033[0m"
WARN = "\033[93m[!]\033[0m"


def separador():
    print("\n" + "─" * 54)

def titulo(txt):
    separador()
    print(f"  {txt}")
    separador()

def pausar(msg="Presiona Enter para continuar..."):
    input(f"\n{msg}")

def salir(msg, ayuda=""):
    print(f"\n{ERR} {msg}")
    if ayuda:
        print()
        for linea in ayuda.strip().splitlines():
            print(f"  {linea}")
    pausar("\nPresiona Enter para cerrar...")
    sys.exit(1)

def ejecutar(cmd, cwd=None, env=None):
    """Ejecuta un comando y devuelve (returncode, stdout+stderr)."""
    result = subprocess.run(
        cmd, cwd=cwd, env=env,
        capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    return result.returncode, result.stdout + result.stderr


# ══════════════════════════════════════════════════════════════════
#  VERIFICACIONES
# ══════════════════════════════════════════════════════════════════

def verificar_python():
    print(f"\n{INFO} Verificando Python...")
    v = sys.version_info
    version_str = f"{v.major}.{v.minor}.{v.micro}"
    if v.major < 3 or (v.major == 3 and v.minor < 10):
        salir(
            f"Python {version_str} detectado — se necesita Python 3.10 o superior.",
            "Descarga la última versión desde:\n"
            "  https://www.python.org/downloads/\n\n"
            "IMPORTANTE: durante la instalación marca la casilla\n"
            "  ✔ Add Python to PATH"
        )
    print(f"{OK} Python {version_str}")


def verificar_node():
    print(f"\n{INFO} Verificando Node.js...")
    code, out = ejecutar(["node", "--version"])
    if code != 0:
        salir(
            "Node.js no encontrado.",
            "Descarga la versión LTS desde:\n"
            "  https://nodejs.org/\n\n"
            "Elige 'Windows Installer (.msi)' y sigue el instalador.\n"
            "Reinicia esta ventana después de instalar."
        )
    version = out.strip()
    try:
        major = int(version.lstrip("v").split(".")[0])
        if major < 18:
            salir(
                f"Node.js {version} encontrado — se necesita versión 18 o superior.",
                "Descarga la LTS desde https://nodejs.org/"
            )
    except ValueError:
        pass
    print(f"{OK} Node.js {version}")

    # Verificar npm también
    code, out = ejecutar(["npm.cmd", "--version"])
    if code == 0:
        print(f"{OK} npm {out.strip()}")


def verificar_postgres():
    print(f"\n{INFO} Verificando PostgreSQL...")

    # Buscar directorio de instalación
    pg_bin = None
    for ver in ["17", "16", "15", "14"]:
        p = Path(f"C:/Program Files/PostgreSQL/{ver}/bin")
        if p.exists():
            pg_bin = p
            pg_ver = ver
            break

    if not pg_bin:
        salir(
            "PostgreSQL no encontrado.",
            "Descarga PostgreSQL 17 desde:\n"
            "  https://www.postgresql.org/download/windows/\n\n"
            "Durante la instalación:\n"
            "  • Deja el puerto en 5432 (por defecto)\n"
            "  • Anota bien la contraseña que ingreses para 'postgres'\n"
            "  • No es necesario instalar Stack Builder al final\n\n"
            "Reinicia esta ventana después de instalar."
        )

    print(f"{OK} PostgreSQL {pg_ver} encontrado en {pg_bin}")
    return pg_bin, pg_ver


# ══════════════════════════════════════════════════════════════════
#  CONFIGURACIÓN .env
# ══════════════════════════════════════════════════════════════════

def configurar_env():
    env_path = BACKEND / ".env"

    if env_path.exists():
        print(f"\n{OK} backend/.env ya existe — no se sobreescribe.")
        return

    print(f"\n{INFO} Configurando base de datos...")
    print()
    print("  Necesito la contraseña que pusiste al instalar PostgreSQL.")
    print("  Usuario: postgres  |  Host: localhost  |  Puerto: 5432")
    print()

    intentos = 0
    while True:
        password = input("  Contraseña de PostgreSQL (postgres): ").strip()
        if not password:
            print(f"  {WARN} La contraseña no puede estar vacía. Intenta de nuevo.")
            intentos += 1
            if intentos >= 3:
                salir(
                    "No se ingresó contraseña.",
                    "Puedes crear el archivo backend/.env manualmente con:\n"
                    "DATABASE_URL=postgresql://postgres:TU_CONTRASEÑA@localhost:5432/slr_manager"
                )
            continue

        # Verificar que la contraseña es correcta intentando conectar
        print(f"  {INFO} Verificando contraseña...", end=" ", flush=True)
        ok = _probar_conexion("localhost", 5432, "postgres", password)
        if ok:
            print("✓")
            break
        else:
            print()
            print(f"  {WARN} No se pudo conectar. Verifica la contraseña e intenta de nuevo.")
            intentos += 1
            if intentos >= 5:
                salir(
                    "Demasiados intentos fallidos.",
                    "Crea backend/.env manualmente con:\n"
                    "DATABASE_URL=postgresql://postgres:TU_CONTRASEÑA@localhost:5432/slr_manager"
                )

    contenido = (
        f"DATABASE_URL=postgresql://postgres:{password}@localhost:5432/slr_manager\n"
        "SECRET_KEY=cambia_esto_por_una_clave_segura_aleatoria\n"
        "DEBUG=false\n"
    )
    env_path.write_text(contenido, encoding="utf-8")
    print(f"{OK} backend/.env creado.")


def _probar_conexion(host, port, user, password):
    """Intenta conectar a PostgreSQL para verificar credenciales."""
    # Primero verificar que el puerto esté abierto
    try:
        with socket.create_connection((host, port), timeout=3):
            pass
    except OSError:
        return False

    try:
        import psycopg2
        conn = psycopg2.connect(
            host=host, port=port, user=user, password=password,
            database="postgres", connect_timeout=5
        )
        conn.close()
        return True
    except Exception:
        return False


# ══════════════════════════════════════════════════════════════════
#  INSTALACIÓN DE PAQUETES
# ══════════════════════════════════════════════════════════════════

def instalar_python_packages():
    print(f"\n{INFO} Instalando paquetes Python (puede tardar 2-3 minutos)...")
    req = BACKEND / "requirements.txt"
    if not req.exists():
        salir("No se encontró backend/requirements.txt")

    code, out = ejecutar(
        [sys.executable, "-m", "pip", "install", "-r", str(req), "--quiet"],
        cwd=str(BACKEND),
    )
    if code != 0:
        print(out[-2000:])  # mostrar últimas líneas de error
        salir(
            "Error al instalar paquetes Python.",
            "Intenta ejecutar manualmente:\n"
            "  pip install -r backend/requirements.txt\n"
            "Si hay errores de permisos, abre el CMD como Administrador."
        )
    print(f"{OK} Paquetes Python instalados.")


def instalar_node_packages():
    print(f"\n{INFO} Instalando paquetes Node.js (puede tardar 1-2 minutos)...")
    if not (FRONTEND / "package.json").exists():
        salir("No se encontró frontend/package.json")

    code, out = ejecutar(["npm.cmd", "install"], cwd=str(FRONTEND))
    if code != 0:
        print(out[-2000:])
        salir(
            "Error al instalar paquetes Node.js.",
            "Intenta ejecutar manualmente en la carpeta frontend/:\n"
            "  npm install"
        )
    print(f"{OK} Paquetes Node.js instalados.")


# ══════════════════════════════════════════════════════════════════
#  CARPETAS Y ESTRUCTURA
# ══════════════════════════════════════════════════════════════════

def crear_carpetas():
    print(f"\n{INFO} Creando carpetas de datos...")
    carpetas = [
        ROOT / "data" / "PDFs",
        ROOT / "data" / "exports",
        ROOT / "data" / "backups",
    ]
    for c in carpetas:
        c.mkdir(parents=True, exist_ok=True)
    print(f"{OK} Carpetas creadas en data/")


# ══════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════

def main():
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║         SLR Manager — Asistente de Instalación      ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()
    print("  Este asistente configurará todo lo necesario para")
    print("  ejecutar SLR Manager en tu computador.")
    print()
    pausar("  Presiona Enter para comenzar...")

    # ── 1. Verificaciones ──────────────────────────────────────────
    titulo("PASO 1/4 — Verificando requisitos del sistema")
    verificar_python()
    verificar_node()
    pg_bin, pg_ver = verificar_postgres()

    # ── 2. Instalar paquetes ───────────────────────────────────────
    titulo("PASO 2/4 — Instalando dependencias")
    instalar_python_packages()
    instalar_node_packages()

    # ── 3. Configurar .env ─────────────────────────────────────────
    titulo("PASO 3/4 — Configuración de la base de datos")
    configurar_env()

    # ── 4. Carpetas ────────────────────────────────────────────────
    titulo("PASO 4/4 — Preparando estructura de archivos")
    crear_carpetas()

    # ── Finalizado ─────────────────────────────────────────────────
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║          ¡Instalación completada con éxito!          ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()
    print("  Para iniciar la aplicación:")
    print()
    print("  ➤  Haz doble clic en  start.bat")
    print()
    print("  La primera vez puede tardar ~15 segundos en abrir.")
    print("  Se abrirá automáticamente en tu navegador.")
    print()
    pausar("Presiona Enter para cerrar este asistente...")


if __name__ == "__main__":
    main()
