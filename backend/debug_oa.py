"""
Script de diagnóstico para el problema de descarga OA.
Ejecutar desde la carpeta backend:  python debug_oa.py

Prueba:
1. Cuántas refs tienen DOI en cada búsqueda
2. Consulta Unpaywall con 5 DOIs reales
3. Intenta descargar el primer PDF encontrado
"""

import sys
import requests
import time
from pathlib import Path

# ── Conexión BD ────────────────────────────────────────────────
try:
    import psycopg2
    # Leer DATABASE_URL del .env (un nivel arriba de backend/)
    import os, sys
    from pathlib import Path
    from dotenv import load_dotenv
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(env_path)
    db_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/slr_manager")
    # Parsear la URL manualmente
    from urllib.parse import urlparse
    u = urlparse(db_url)
    conn = psycopg2.connect(
        host=u.hostname, port=u.port or 5432,
        dbname=u.path.lstrip("/"),
        user=u.username, password=u.password
    )
    cur = conn.cursor()
    print(" Conexión a PostgreSQL OK\n")
except Exception as e:
    print(f" No se pudo conectar a PostgreSQL: {e}")
    sys.exit(1)

# ── 1. Estado de las búsquedas ─────────────────────────────────
print("=" * 60)
print("1. ESTADO DE LAS BÚSQUEDAS")
print("=" * 60)
cur.execute("SELECT id, name FROM searches ORDER BY id;")
searches = cur.fetchall()
for s in searches:
    sid, sname = s
    cur.execute("""
        SELECT COUNT(*) FROM "references" r
        JOIN search_references sr ON sr.reference_id = r.id
        WHERE sr.search_id = %s
    """, (sid,))
    total = cur.fetchone()[0]
    cur.execute("""
        SELECT COUNT(*) FROM "references" r
        JOIN search_references sr ON sr.reference_id = r.id
        WHERE sr.search_id = %s AND r.doi IS NOT NULL AND r.doi != ''
    """, (sid,))
    with_doi = cur.fetchone()[0]
    cur.execute("""
        SELECT COUNT(*) FROM "references" r
        JOIN search_references sr ON sr.reference_id = r.id
        WHERE sr.search_id = %s AND r.pdf_file IS NOT NULL
    """, (sid,))
    with_pdf = cur.fetchone()[0]
    cur.execute("""
        SELECT COUNT(*) FROM "references" r
        JOIN search_references sr ON sr.reference_id = r.id
        WHERE sr.search_id = %s AND r.pdf_file IS NULL
        AND (r.doi IS NULL OR r.doi = '')
    """, (sid,))
    no_doi = cur.fetchone()[0]
    print(f"  Search {sid}: {sname}")
    print(f"    Total: {total} | Con DOI: {with_doi} | Sin DOI: {no_doi} | Con PDF: {with_pdf}")

# ── 2. DOIs de muestra ─────────────────────────────────────────
print("\n" + "=" * 60)
print("2. 10 DOIs DE MUESTRA (sin PDF)")
print("=" * 60)
cur.execute("""
    SELECT r.id, r.doi FROM "references" r
    WHERE r.doi IS NOT NULL AND r.doi != '' AND r.pdf_file IS NULL
    LIMIT 10
""")
sample_refs = cur.fetchall()
if not sample_refs:
    print("     No hay referencias sin PDF con DOI!")
    cur.close(); conn.close(); sys.exit(0)

for ref in sample_refs:
    print(f"  ID={ref[0]}: {ref[1]}")

# ── 3. Prueba Unpaywall con los primeros 5 DOIs ────────────────
print("\n" + "=" * 60)
print("3. PRUEBA UNPAYWALL (primeros 5 DOIs)")
print("=" * 60)
EMAIL = os.getenv("OA_EMAIL", "")
if not EMAIL:
    print("  ADVERTENCIA: OA_EMAIL no configurado en .env — las consultas a Unpaywall pueden fallar")
HEADERS = {"User-Agent": f"SLR-Manager/1.0 (mailto:{EMAIL})"}
pdf_url_found = None
ref_id_found = None

for ref_id, doi in sample_refs[:5]:
    url = f"https://api.unpaywall.org/v2/{doi}?email={EMAIL}"
    print(f"\n  DOI: {doi}")
    print(f"  URL: {url}")
    try:
        r = requests.get(url, timeout=10, headers=HEADERS)
        print(f"  Status HTTP: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            is_oa = data.get("is_oa", False)
            oa_status = data.get("oa_status", "?")
            best = data.get("best_oa_location")
            url_for_pdf = best.get("url_for_pdf") if best else None
            url_landing = best.get("url") if best else None
            oa_locations_count = len(data.get("oa_locations", []))
            print(f"  is_oa: {is_oa} | oa_status: {oa_status}")
            print(f"  best_oa_location.url_for_pdf: {url_for_pdf}")
            print(f"  best_oa_location.url: {url_landing}")
            print(f"  Total oa_locations: {oa_locations_count}")
            if is_oa and url_for_pdf and not pdf_url_found:
                pdf_url_found = url_for_pdf
                ref_id_found = ref_id
                print(f"   PDF URL encontrado! Usaremos este para test de descarga.")
            elif is_oa and not url_for_pdf:
                print(f"    is_oa=True pero url_for_pdf=None (solo landing page)")
        elif r.status_code == 404:
            print(f"   DOI no encontrado en Unpaywall")
        else:
            print(f"   Error inesperado: {r.status_code}")
    except Exception as e:
        print(f"   Error: {e}")
    time.sleep(0.2)

# ── 4. Test de descarga ────────────────────────────────────────
print("\n" + "=" * 60)
print("4. TEST DE DESCARGA PDF")
print("=" * 60)
if not pdf_url_found:
    print("    No se encontró ningún PDF URL en los 5 primeros DOIs.")
    print("       Puede que todos los OA de esta búsqueda sean solo landing pages.")
    print("       Prueba con la búsqueda completa o con un DOI conocido como OA con PDF.")
    print()
    print("  SUGERENCIA: Prueba este DOI conocido con PDF directo:")
    test_doi = "10.1371/journal.pone.0000308"
    url = f"https://api.unpaywall.org/v2/{test_doi}?email={EMAIL}"
    r = requests.get(url, timeout=10, headers=HEADERS)
    if r.status_code == 200:
        data = r.json()
        best = data.get("best_oa_location")
        test_pdf_url = best.get("url_for_pdf") if best else None
        print(f"  DOI de prueba: {test_doi}")
        print(f"  url_for_pdf: {test_pdf_url}")
        if test_pdf_url:
            pdf_url_found = test_pdf_url
            ref_id_found = "TEST"
else:
    pass

if pdf_url_found:
    print(f"\n  Descargando desde: {pdf_url_found}")
    try:
        r = requests.get(pdf_url_found, timeout=30, headers=HEADERS, allow_redirects=True, stream=True)
        print(f"  Status: {r.status_code}")
        print(f"  Content-Type: {r.headers.get('content-type', 'N/A')}")
        print(f"  Content-Length: {r.headers.get('content-length', 'N/A')}")

        content = b""
        for chunk in r.iter_content(8192):
            content += chunk
            if len(content) >= 10:
                break

        print(f"  Primeros bytes: {content[:10]}")
        is_pdf = content.startswith(b"%PDF")
        print(f"  ¿Empieza con %PDF? {' SÍ' if is_pdf else ' NO (probablemente HTML/redirect)'}")

        if not is_pdf:
            # Podría ser HTML de una landing page
            try:
                text = content.decode('utf-8', errors='ignore')[:200]
                print(f"  Contenido (primeros 200 chars): {text}")
            except:
                pass
    except Exception as e:
        print(f"  ❌ Error descargando: {e}")

cur.close()
conn.close()
print("\n" + "=" * 60)
print(" Diagnóstico completo")
print("=" * 60)
