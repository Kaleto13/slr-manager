"""
SLR Manager - Launcher
Levanta PostgreSQL, crea la BD si no existe, backend y frontend.
"""
import subprocess
import sys
import time
import socket
import webbrowser
import ctypes
import os
from pathlib import Path
from urllib.parse import urlparse

ROOT     = Path(__file__).resolve().parent
BACKEND  = ROOT / "backend"
FRONTEND = ROOT / "frontend"

CREATE_NEW_CONSOLE = 0x00000010  # Windows: abre nueva ventana CMD


# ── Utilidades ─────────────────────────────────────────────────────────────

def check(ok, msg, hint=""):
    if not ok:
        print(f"\n[ERROR] {msg}")
        if hint:
            for line in hint.splitlines():
                print(f"        {line}")
        input("\nPresiona Enter para salir...")
        sys.exit(1)

def is_port_open(host="localhost", port=5432):
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except OSError:
        return False

def parse_env():
    """Lee DATABASE_URL del archivo backend/.env"""
    env_file = BACKEND / ".env"
    for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip("\"'")
    return None

def find_pg_bin():
    """Busca el directorio bin de PostgreSQL instalado."""
    for version in ["17", "16", "15", "14", "18"]:
        path = Path(f"C:/Program Files/PostgreSQL/{version}/bin")
        if path.exists():
            return path
    return None

def find_postgres_service():
    """Busca el nombre del servicio PostgreSQL en Windows."""
    try:
        result = subprocess.run(
            ["sc", "query", "type=", "all", "state=", "all"],
            capture_output=True, text=True
        )
        current = None
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("SERVICE_NAME:"):
                current = line.split("SERVICE_NAME:")[-1].strip()
            if current and "postgresql" in current.lower():
                return current
            if line.startswith("SERVICE_NAME:"):
                current = None
    except Exception:
        pass
    return None

def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False

def relaunch_as_admin():
    script = str(Path(__file__).resolve())
    ctypes.windll.shell32.ShellExecuteW(
        None, "runas", sys.executable, f'"{script}"', None, 1
    )
    sys.exit(0)


# ── Paso 0a: PostgreSQL corriendo ──────────────────────────────────────────

def ensure_postgres_running():
    if is_port_open():
        print("[OK] PostgreSQL ya esta corriendo.")
        return

    print("[!!] PostgreSQL no esta corriendo. Buscando servicio...")
    service = find_postgres_service()

    if not service:
        print("\n[ERROR] No se encontro ningun servicio PostgreSQL instalado.")
        print("        Descarga PostgreSQL 17 desde https://postgresql.org")
        input("\nPresiona Enter para salir...")
        sys.exit(1)

    print(f"     Servicio encontrado: {service}")
    result = subprocess.run(
        ["net", "start", service], capture_output=True, text=True
    )

    stderr_lower = result.stderr.lower() + result.stdout.lower()
    if result.returncode != 0 and ("acceso" in stderr_lower or "access" in stderr_lower
                                    or "privilege" in stderr_lower):
        if not is_admin():
            print()
            print("     Se necesitan permisos de administrador.")
            print("     Se abrira ventana UAC — acepta para continuar.")
            input("     Presiona Enter para solicitar permisos...")
            relaunch_as_admin()

    # Esperar que levante
    print("     Esperando que PostgreSQL levante", end="", flush=True)
    for _ in range(15):
        time.sleep(1)
        print(".", end="", flush=True)
        if is_port_open():
            print(" listo!")
            return
    print()
    print("[AVISO] PostgreSQL tarda en responder. Continuando de todas formas...")


# ── Paso 0b: Base de datos existe ──────────────────────────────────────────

def ensure_database():
    db_url = parse_env()
    if not db_url:
        print("[AVISO] No se encontro DATABASE_URL en .env — omitiendo verificacion de BD.")
        return

    parsed   = urlparse(db_url)
    dbname   = parsed.path.lstrip("/")
    user     = parsed.username or "postgres"
    password = parsed.password or ""
    host     = parsed.hostname or "localhost"
    port     = parsed.port or 5432

    print(f"     Base de datos objetivo: '{dbname}' en {host}:{port}")

    # Intentar con psycopg2 (ya instalado en el entorno del backend)
    try:
        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

        conn = psycopg2.connect(
            host=host, port=port, user=user, password=password,
            database="postgres", connect_timeout=5
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()

        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,))
        exists = cur.fetchone()

        if not exists:
            print(f"     Base de datos '{dbname}' no existe. Creando...")
            cur.execute(f'CREATE DATABASE "{dbname}"')
            print(f"[OK] Base de datos '{dbname}' creada exitosamente.")
        else:
            print(f"[OK] Base de datos '{dbname}' ya existe.")

        cur.close()
        conn.close()
        return

    except ImportError:
        pass  # psycopg2 no disponible aqui, usar pg_bin

    except Exception as e:
        print(f"[AVISO] No se pudo verificar la BD via psycopg2: {e}")

    # Fallback: usar psql / createdb de la instalacion de PostgreSQL
    pg_bin = find_pg_bin()
    if not pg_bin:
        print("[AVISO] No se encontro el directorio bin de PostgreSQL.")
        return

    env = {**os.environ, "PGPASSWORD": password}
    psql = str(pg_bin / "psql.exe")

    # Verificar si la BD existe
    result = subprocess.run(
        [psql, "-U", user, "-h", host, "-p", str(port),
         "-d", "postgres", "-tAc",
         f"SELECT 1 FROM pg_database WHERE datname='{dbname}'"],
        capture_output=True, text=True, env=env
    )

    if result.stdout.strip() == "1":
        print(f"[OK] Base de datos '{dbname}' ya existe.")
    else:
        print(f"     Creando base de datos '{dbname}'...")
        subprocess.run(
            [str(pg_bin / "createdb.exe"), "-U", user, "-h", host,
             "-p", str(port), dbname],
            env=env
        )
        print(f"[OK] Base de datos '{dbname}' creada.")


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    print("=" * 52)
    print("  SLR Manager - Iniciando aplicacion")
    print("=" * 52)
    print()

    # Verificar archivos del proyecto
    check((BACKEND / "main.py").exists(),       "No se encontro backend/main.py")
    check((FRONTEND / "package.json").exists(), "No se encontro frontend/package.json")
    check(
        (BACKEND / ".env").exists(),
        "No se encontro backend/.env",
        "Es la primera vez que ejecutas la aplicacion?\n"
        "Ejecuta primero  instalar.bat  para configurar todo.\n\n"
        "Si ya instalaste, crea backend/.env con:\n"
        "  DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/slr_manager"
    )
    check(
        (FRONTEND / "node_modules").exists(),
        "No se encontraron las dependencias del frontend.",
        "Ejecuta  instalar.bat  para instalar todo correctamente."
    )

    # 0a — PostgreSQL corriendo
    print("[0/2] Verificando PostgreSQL...")
    ensure_postgres_running()

    # 0b — Base de datos existe
    print("[DB]  Verificando base de datos...")
    ensure_database()
    print()

    # 1 — Backend (las tablas las crea el lifespan de FastAPI)
    print("[1/2] Iniciando Backend  (http://localhost:8000) ...")
    subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app",
         "--reload", "--host", "0.0.0.0", "--port", "8000"],
        cwd=str(BACKEND),
        creationflags=CREATE_NEW_CONSOLE,
    )
    print("      Esperando que levante (5 seg)...")
    time.sleep(5)

    # 2 — Frontend
    print("[2/2] Iniciando Frontend (http://localhost:5173) ...")
    subprocess.Popen(
        ["cmd", "/k", "npm run dev"],
        cwd=str(FRONTEND),
        creationflags=CREATE_NEW_CONSOLE,
    )
    print("      Esperando que compile  (6 seg)...")
    time.sleep(6)

    # Abrir navegador
    webbrowser.open("http://localhost:5173")

    print()
    print("=" * 52)
    print("  Aplicacion lista")
    print("=" * 52)
    print()
    print("  Frontend : http://localhost:5173")
    print("  Backend  : http://localhost:8000")
    print("  API Docs : http://localhost:8000/docs")
    print()
    print("Puedes cerrar esta ventana.")
    print("El backend y frontend siguen en sus ventanas.")
    print()
    input("Presiona Enter para cerrar el launcher...")


if __name__ == "__main__":
    main()
