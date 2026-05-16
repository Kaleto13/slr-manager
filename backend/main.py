import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database import Base, engine
from config import DEBUG

# Configurar logging para ver mensajes de oa_downloader en la consola de uvicorn
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s  %(name)s: %(message)s",
)
logging.getLogger("services.oa_downloader").setLevel(logging.DEBUG)

# Importar todos los modelos para que Base.metadata los registre
import models  # noqa: F401

# Routers
from routers.imports import router as imports_router
from routers.searches import router as searches_router
from routers.pdfs import router as pdfs_router
from routers.references import router as references_router
from routers.dedup import router as dedup_router
from routers.screening import router as screening_router
from routers.custom_fields import router as extraction_router
from routers.costs import router as costs_router
from routers.qa        import router as qa_router
from routers.stats     import router as stats_router
from routers.changelog   import router as changelog_router
from routers.annotations import router as annotations_router


def _run_migrations():
    """Migraciones manuales de columnas nuevas (idempotentes)."""
    from sqlalchemy import text
    migrations = [
        # Columnas nuevas en screening_decisions
        "ALTER TABLE screening_decisions ADD COLUMN IF NOT EXISTS criterion_id INTEGER REFERENCES screening_criteria(id) ON DELETE SET NULL",
        "ALTER TABLE screening_decisions ADD COLUMN IF NOT EXISTS notes TEXT",
        "ALTER TABLE screening_decisions ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP WITH TIME ZONE",
        # Cambiar 'reason' a 'notes' si todavía existe la columna vieja
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='screening_decisions' AND column_name='reason') THEN ALTER TABLE screening_decisions RENAME COLUMN reason TO reason_old; END IF; END $$",
        # Múltiples criterios por decisión de screening
        "ALTER TABLE screening_decisions ADD COLUMN IF NOT EXISTS criterion_ids JSONB DEFAULT '[]'",
        # Columna options para campos de tipo select / multiselect
        "ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS options TEXT",
        # Columnas de costo y tokens en qa_responses
        "ALTER TABLE qa_responses ADD COLUMN IF NOT EXISTS cost_usd FLOAT DEFAULT 0.0",
        "ALTER TABLE qa_responses ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0",
        "ALTER TABLE qa_responses ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception as e:
                conn.rollback()
                print(f"  Migración omitida: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(" Creating database tables...")
    try:
        Base.metadata.create_all(engine)
        print(" Database tables created successfully!")
    except Exception as e:
        print(f" Error creating tables: {e}")
    print(" Running migrations...")
    try:
        _run_migrations()
        print(" Migrations applied!")
    except Exception as e:
        print(f" Error in migrations: {e}")
    yield
    print(" Shutting down...")


app = FastAPI(
    title="SLR-Manager",
    description="Herramienta de Revisión Sistemática de Literatura",
    version="0.3.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://127.0.0.1:5173",
        "app://.",                 # Electron protocolo custom (producción)
        "file://",                 # Electron loadFile (producción)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registrar routers (Vite proxy ya elimina el prefijo /api)
app.include_router(imports_router)
app.include_router(searches_router)
app.include_router(pdfs_router)
app.include_router(references_router)
app.include_router(dedup_router)
app.include_router(screening_router)
app.include_router(extraction_router)
app.include_router(costs_router)
app.include_router(qa_router)
app.include_router(stats_router)
app.include_router(changelog_router)
app.include_router(annotations_router)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "database": "connected",
        "debug": DEBUG,
        "version": "0.3.0"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
