#!/bin/bash
# ============================================================
#  backup_db.sh — Backup manual de la base de datos SLR-Manager
#
#  Uso:
#    chmod +x backup_db.sh
#    ./backup_db.sh
#
#  Genera un archivo .sql.gz con timestamp en la carpeta backups/
#  Requiere: pg_dump, gzip, acceso al .env del backend
# ============================================================

set -euo pipefail

# ── Cargar variables del .env ─────────────────────────────────────────────────
ENV_FILE="$(dirname "$0")/backend/.env"
if [ -f "$ENV_FILE" ]; then
  # Exportar solo variables relevantes, ignorando líneas de comentario
  export $(grep -v '^#' "$ENV_FILE" | grep -E 'DATABASE_URL' | xargs) 2>/dev/null || true
fi

# ── Configuración ─────────────────────────────────────────────────────────────
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/slr_manager}"
BACKUP_DIR="$(dirname "$0")/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/slr_manager_${TIMESTAMP}.sql.gz"

# ── Colores (si la terminal lo soporta) ──────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "======================================================"
echo "  SLR-Manager — Backup de base de datos"
echo "======================================================"
echo ""

# ── Crear directorio backups/ si no existe ────────────────────────────────────
mkdir -p "$BACKUP_DIR"
echo -e "${YELLOW}📁 Carpeta de backups:${NC} $BACKUP_DIR"

# ── Verificar pg_dump ─────────────────────────────────────────────────────────
if ! command -v pg_dump &> /dev/null; then
  echo -e "${RED}❌ pg_dump no encontrado. Instala postgresql-client.${NC}"
  echo "   En Ubuntu/Debian: sudo apt install postgresql-client"
  echo "   En macOS: brew install postgresql"
  exit 1
fi

# ── Parsear DATABASE_URL ──────────────────────────────────────────────────────
# Formato: postgresql://user:password@host:port/dbname
DB_URL="$DATABASE_URL"

# Extraer componentes con python3 (más robusto que regex en bash)
if command -v python3 &> /dev/null; then
  read DB_USER DB_PASS DB_HOST DB_PORT DB_NAME <<< $(python3 -c "
from urllib.parse import urlparse
u = urlparse('$DB_URL')
print(u.username or '', u.password or '', u.hostname or 'localhost', u.port or 5432, u.path.lstrip('/'))
")
else
  echo -e "${RED}❌ python3 no encontrado. Necesario para parsear DATABASE_URL.${NC}"
  exit 1
fi

echo -e "${YELLOW}🔌 Conectando a:${NC} ${DB_HOST}:${DB_PORT}/${DB_NAME} (usuario: ${DB_USER})"
echo ""

# ── Ejecutar pg_dump ──────────────────────────────────────────────────────────
echo -e "${YELLOW}⏳ Generando backup...${NC}"

PGPASSWORD="$DB_PASS" pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  | gzip > "$BACKUP_FILE"

FILE_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)

echo ""
echo -e "${GREEN}✅ Backup completado exitosamente${NC}"
echo -e "   Archivo: ${BACKUP_FILE}"
echo -e "   Tamaño:  ${FILE_SIZE}"
echo ""

# ── Mantener solo los últimos 10 backups ─────────────────────────────────────
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 10 ]; then
  echo -e "${YELLOW}🧹 Limpiando backups antiguos (manteniendo últimos 10)...${NC}"
  ls -1t "${BACKUP_DIR}"/*.sql.gz | tail -n +11 | xargs rm -f
  echo -e "   Eliminados: $((BACKUP_COUNT - 10)) archivos antiguos"
fi

echo ""
echo -e "${YELLOW}📋 Backups disponibles:${NC}"
ls -lh "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | awk '{print "   " $5 "  " $9}' || echo "   (ninguno)"
echo ""

# ── Instrucción de restauración ───────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Para restaurar este backup:"
echo ""
echo "  gunzip -c $BACKUP_FILE | \\"
echo "    PGPASSWORD='<contraseña>' psql \\"
echo "    --host=$DB_HOST --port=$DB_PORT \\"
echo "    --username=$DB_USER --dbname=$DB_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
