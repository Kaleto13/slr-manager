"""
Router: ChangeLog

GET  /changelog            → lista paginada con filtros opcionales
GET  /changelog/export     → descarga CSV del log completo
GET  /changelog/stats      → resumen de acciones
"""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
import csv
import io

from database import get_db
from models.change_log import ChangeLog

router = APIRouter(prefix="/changelog", tags=["changelog"])


# ──────────────────────────────────────────────────────────────────────────────
#  GET /changelog
# ──────────────────────────────────────────────────────────────────────────────
@router.get("")
def list_changelog(
    entity:    Optional[str] = Query(None, description="Filtrar por tabla: references, searches, screening, etc."),
    action:    Optional[str] = Query(None, description="Filtrar por acción: import, delete, update, screen, etc."),
    entity_id: Optional[int] = Query(None, description="Filtrar por ID de registro"),
    search:    Optional[str] = Query(None, description="Búsqueda en el campo detail (texto libre)"),
    skip:      int           = Query(0,    ge=0),
    limit:     int           = Query(50,   ge=1, le=500),
    db: Session = Depends(get_db),
):
    """
    Lista de entradas del change_log con filtros opcionales.
    Orden: más recientes primero.
    """
    q = db.query(ChangeLog)

    if entity:
        q = q.filter(ChangeLog.entity == entity)
    if action:
        q = q.filter(ChangeLog.action == action)
    if entity_id is not None:
        q = q.filter(ChangeLog.entity_id == entity_id)
    if search:
        q = q.filter(ChangeLog.detail.ilike(f"%{search}%"))

    total = q.count()
    rows  = q.order_by(ChangeLog.created_at.desc()).offset(skip).limit(limit).all()

    return {
        "total": total,
        "skip":  skip,
        "limit": limit,
        "items": [
            {
                "id":        r.id,
                "action":    r.action,
                "entity":    r.entity,
                "entity_id": r.entity_id,
                "detail":    r.detail,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


# ──────────────────────────────────────────────────────────────────────────────
#  GET /changelog/stats
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/stats")
def changelog_stats(db: Session = Depends(get_db)):
    """
    Resumen del log: total de entradas, acciones más frecuentes, entidades más afectadas.
    """
    total = db.query(ChangeLog).count()

    # Conteo por acción
    action_rows = db.execute(
        text('SELECT action, COUNT(*) as cnt FROM change_log GROUP BY action ORDER BY cnt DESC LIMIT 10')
    ).fetchall()

    # Conteo por entidad
    entity_rows = db.execute(
        text('SELECT entity, COUNT(*) as cnt FROM change_log WHERE entity IS NOT NULL GROUP BY entity ORDER BY cnt DESC LIMIT 10')
    ).fetchall()

    # Última actividad
    last = db.query(ChangeLog).order_by(ChangeLog.created_at.desc()).first()

    return {
        "total": total,
        "by_action": [{"action": r[0], "count": r[1]} for r in action_rows],
        "by_entity": [{"entity": r[0], "count": r[1]} for r in entity_rows],
        "last_activity": last.created_at.isoformat() if last and last.created_at else None,
    }


# ──────────────────────────────────────────────────────────────────────────────
#  GET /changelog/entities  — valores únicos para filtros dropdown
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/entities")
def changelog_entities(db: Session = Depends(get_db)):
    actions  = db.execute(text("SELECT DISTINCT action FROM change_log WHERE action IS NOT NULL ORDER BY action")).fetchall()
    entities = db.execute(text("SELECT DISTINCT entity FROM change_log WHERE entity IS NOT NULL ORDER BY entity")).fetchall()
    return {
        "actions":  [r[0] for r in actions],
        "entities": [r[0] for r in entities],
    }


# ──────────────────────────────────────────────────────────────────────────────
#  GET /changelog/export  — CSV descargable
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/export")
def export_changelog(
    entity:    Optional[str] = Query(None),
    action:    Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(ChangeLog).order_by(ChangeLog.created_at.desc())
    if entity:
        q = q.filter(ChangeLog.entity == entity)
    if action:
        q = q.filter(ChangeLog.action == action)

    rows = q.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "created_at", "action", "entity", "entity_id", "detail"])
    for r in rows:
        writer.writerow([
            r.id,
            r.created_at.isoformat() if r.created_at else "",
            r.action or "",
            r.entity or "",
            r.entity_id or "",
            r.detail or "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=changelog.csv"},
    )
