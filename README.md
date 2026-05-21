# SLR Manager

Herramienta de escritorio para gestionar **Revisiones Sistemáticas de Literatura (SLR)**. Permite importar referencias bibliográficas, realizar screening en dos rondas, descargar PDFs automáticamente y extraer texto para análisis.

---
![GitHub release](https://img.shields.io/github/release/Kaleto13/slr-manager.svg)

[![Release](https://img.shields.io/github/v/release/Kaleto13/slr-manager)](https://github.com/Kaleto13/slr-manager/releases)

## Requisitos previos

Antes de instalar, necesitas estos tres programas. Si ya los tienes, salta directo a **Instalación**.

### 1. Python 3.10 o superior

Descarga desde [python.org/downloads](https://www.python.org/downloads/) y elige la versión más reciente.

> **Importante:** durante la instalación, marca la casilla **"Add Python to PATH"** antes de hacer clic en _Install Now_.

Para verificar que quedó instalado, abre CMD y escribe:
```
python --version
```
Debe mostrar algo como `Python 3.13.x`.

---

### 2. Node.js 18 LTS o superior

Descarga desde [nodejs.org](https://nodejs.org/) y elige **LTS (Recommended for most users)**.

Instala con las opciones por defecto. Para verificar:
```
node --version
```
Debe mostrar algo como `v22.x.x`.

---

### 3. PostgreSQL 17

Descarga desde [postgresql.org/download/windows](https://www.postgresql.org/download/windows/) → **Download the installer**.

Durante la instalación:
- Deja el puerto en **5432** (valor por defecto, no lo cambies).
- Elige una contraseña para el usuario `postgres` y **anótala** — la necesitarás luego.
- Al final, cuando pregunte por Stack Builder, puedes cerrar sin instalar nada adicional.

---

## Instalación (solo la primera vez)

Con los tres programas instalados:

**1.** Clona el repositorio (o descarga el ZIP desde GitHub y descomprímelo):

```bash
git clone https://github.com/TU_USUARIO/slr-manager.git
cd slr-manager
```

**2.** Configura tus credenciales de base de datos:

```bash
# En Windows (CMD):
copy backend\.env.example backend\.env
```

Abre `backend\.env` con el Bloc de notas y reemplaza `TU_CONTRASEÑA` con la contraseña que elegiste al instalar PostgreSQL:

```env
DATABASE_URL=postgresql://postgres:TU_CONTRASEÑA@localhost:5432/slr_manager
```

Si usas extracción automática con IA, agrega también tus claves de API (puedes dejarlas vacías si no las necesitas):

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
```

**3.** Genera los archivos de inicio `.bat`:

```bash
python generar_bats.py
```

Esto crea `instalar.bat`, `start.bat` y `detener.bat` en la carpeta raíz.

**4.** Abre la carpeta y haz **doble clic en `instalar.bat`**.

```
SLR-Manager/
├── generar_bats.py    <- ejecutar primero al clonar el repo
├── instalar.bat       <- doble clic aquí  (primera vez)
├── start.bat          <- doble clic aquí  (uso diario)
├── detener.bat        <- cierra la aplicación
├── backend/
│   ├── .env.example   <- plantilla de configuración
│   └── .env           <- tu configuración local (crear desde .env.example)
└── frontend/
```

El asistente verificará que todo esté en orden, instalará las dependencias Python y Node.js, y te pedirá la contraseña de PostgreSQL que anotaste. El proceso tarda **3 a 5 minutos** según tu conexión.

**3.** Cuando aparezca `¡Instalación completada con éxito!`, ya puedes usar `start.bat` para iniciar la aplicación.

---

## Uso diario

Haz **doble clic en `start.bat`** cada vez que quieras abrir la aplicación.

El launcher hace todo automáticamente:
1. Verifica que PostgreSQL esté corriendo (lo inicia si es necesario).
2. Crea la base de datos si es la primera vez.
3. Abre el backend y el frontend en ventanas separadas.
4. Abre la aplicación en tu navegador en `http://localhost:5173`.

> La primera apertura puede tardar ~15 segundos mientras compila el frontend. Las siguientes son más rápidas.

### Cerrar la aplicación

Haz doble clic en **`detener.bat`**, o cierra las dos ventanas de CMD (backend y frontend). El navegador puede quedar abierto sin problema.

---

## Funcionalidades principales

### Importar referencias

Importa archivos `.bib` (BibTeX) exportados desde Zotero, Mendeley, Scopus o Web of Science. Ve a la sección **Búsquedas → Nueva búsqueda** y sube el archivo.

### Screening en dos rondas

**Ronda 1 — Título y Abstract:** revisa cada artículo y decide con las teclas `I` (incluir), `E` (excluir) o `P` (pendiente). Puedes filtrar por decisión y buscar por texto.

**Ronda 2 — Texto completo:** solo aparecen los artículos incluidos en Ronda 1. Si vuelves y agregas más en Ronda 1, se sincronizan automáticamente con un indicador naranja `+N`.

### Descarga de PDFs

La sección **Descarga de PDFs** tiene tres modos:

| Modo | Qué hace | Cuándo usarlo |
|------|----------|---------------|
| **OA** | Busca en Unpaywall (Open Access verificado) | Artículos de libre acceso |
| **Smart** | Prueba 6 estrategias en cascada: Unpaywall → Semantic Scholar → CrossRef → Europe PMC → patrones de publisher → scraping DOI | Cuando estás conectado a la red de tu universidad |
| **Agregar PDF asistido** | Abre los DOIs en el navegador para que descargues tú, luego empareja automáticamente los archivos con los artículos | PDFs que no se pueden descargar automáticamente |

Para subir un PDF manualmente, expande cualquier artículo con `▼` y usa el campo de URL o el botón de subida.

### Visor PDF con anotaciones

Haz clic en el icono de ojo de cualquier artículo con PDF para abrirlo en el visor integrado. Puedes seleccionar texto, escribir notas y agregar anotaciones directamente.

---

## Estructura de archivos

```
SLR-Manager/
├── generar_bats.py       → Genera los archivos .bat (ejecutar al clonar)
├── instalar.bat          → Instalación primera vez
├── instalar.py           → Lógica del asistente de instalación
├── start.bat             → Iniciar la aplicación (uso diario)
├── start.py              → Lógica del launcher
├── detener.bat           → Cierra backend y frontend
├── backend/
│   ├── .env.example      → Plantilla de configuración (versión pública)
│   ├── .env              → Configuración local (contraseña BD)
│   ├── main.py           → Servidor FastAPI
│   ├── models/           → Modelos de base de datos
│   ├── routers/          → Endpoints de la API
│   ├── services/         → Lógica de negocio
│   └── requirements.txt  → Dependencias Python
├── frontend/
│   ├── src/
│   │   └── components/   → Componentes React
│   └── package.json      → Dependencias Node.js
└── data/
    ├── PDFs/             → PDFs descargados o subidos manualmente
    ├── exports/          → Exportaciones PRISMA, Excel, etc.
    └── backups/          → Copias de seguridad de la BD
```

---

## Solución de problemas

### "python no se reconoce como comando"
Python no está en el PATH. Reinstala Python marcando la casilla **"Add Python to PATH"** o reinicia el computador después de instalarlo.

### "No se encontró backend/.env"
El archivo `.env` no se incluye en el repositorio por seguridad. Créalo desde la plantilla:
```bash
copy backend\.env.example backend\.env
```
Luego edítalo con tu contraseña de PostgreSQL.

### "No se pudo conectar a PostgreSQL"
- Verifica que el servicio esté activo: abre el menú Inicio → busca **Servicios** → encuentra `postgresql-x64-17` → debe decir "En ejecución".
- Confirma que la contraseña en `backend/.env` es la correcta.
- El `start.bat` intenta iniciar PostgreSQL automáticamente; si aparece una ventana UAC pidiendo permisos de administrador, acéptala.

### La aplicación abre pero muestra error de conexión
El backend tarda ~10 segundos en arrancar. Espera y recarga con `F5`.

### "npm no se reconoce como comando"
Reinicia el CMD o el computador después de instalar Node.js.

### El puerto 5173 ya está en uso
Cierra otras instancias abiertas de la aplicación, o reinicia el computador.

### Olvidé la contraseña de PostgreSQL
Abre `backend/.env` con el Bloc de notas. La contraseña está en la línea:
```
DATABASE_URL=postgresql://postgres:CONTRASEÑA_AQUI@localhost:5432/slr_manager
```

---

## Copia de seguridad

Tus datos están en PostgreSQL. Para hacer un respaldo, abre CMD y ejecuta:

```bat
"C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -U postgres -d slr_manager -f mi_backup.sql
```

Guarda el archivo `mi_backup.sql` en la nube o en un USB. Para restaurarlo:

```bat
"C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d slr_manager -f mi_backup.sql
```

---

## Requisitos mínimos

| Componente | Mínimo | Recomendado |
|------------|--------|-------------|
| RAM | 4 GB | 8 GB |
| Disco libre | 2 GB | 10 GB (para PDFs) |
| SO | Windows 10 | Windows 10 / 11 |
| Conexión | Para descarga de PDFs OA | Red universitaria para Smart |

---

## Tecnologías

- **Backend:** Python 3.13 · FastAPI 0.115 · SQLAlchemy 2.0 · PostgreSQL 17
- **Frontend:** React 18 · Vite · TailwindCSS · pdfjs-dist 4.x
- **PDF:** PyMuPDF (fitz) · TextLayer seleccionable
- **APIs externas (descarga PDFs):** Unpaywall · Semantic Scholar · CrossRef · Europe PMC

---

*Herramienta de uso académico para revisiones sistemáticas de literatura.*
