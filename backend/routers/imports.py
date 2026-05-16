"""
Router: Importación de archivos .bib
POST /imports/bib    → parsear y guardar referencias, vincular a búsqueda
GET  /imports/status → estado general de la BD

IMPORTANTE: La importación NUNCA deduplica. Cada entrada del .bib crea una
Reference nueva y un SearchReference nuevo. La deduplicación la hace el
usuario manualmente desde "Análisis de Duplicados".
"""

import os
import json
import tempfile
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from database import get_db
from models.reference import Reference
from models.search import Search
from models.search_reference import SearchReference
from models.change_log import ChangeLog
from services.bib_parser import parse_bib_file

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("/bib")
async def import_bib(
    file: UploadFile = File(...),
    search_id: Optional[int] = Form(None),
    source: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """
    Recibe un .bib, lo parsea e inserta TODAS las referencias como filas nuevas.
    No deduplica: cada entrada del .bib genera un Reference + SearchReference nuevo.
    La deduplicación la controla el usuario desde "Análisis de Duplicados".
    """
    if not file.filename.endswith(".bib"):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos .bib")

    # Validar búsqueda si se indicó
    search = None
    if search_id:
        search = db.query(Search).filter(Search.id == search_id).first()
        if not search:
            raise HTTPException(status_code=404, detail=f"Búsqueda {search_id} no encontrada")

    # Guardar archivo temporalmente
    with tempfile.NamedTemporaryFile(delete=False, suffix=".bib") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    imported = 0
    linked = 0
    errors = []

    try:
        refs = parse_bib_file(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Error parseando .bib: {str(e)}")
    finally:
        os.unlink(tmp_path)

    for ref_data in refs:
        try:
            with db.begin_nested():  # SAVEPOINT — si falla, solo revierte esta entrada
                # Crear siempre una Reference nueva (sin deduplicar)
                ref = Reference(**ref_data)
                db.add(ref)
                db.flush()
                imported += 1

                db.add(ChangeLog(
                    action="import",
                    entity="references",
                    entity_id=ref.id,
                    detail=f"Imported: {ref_data.get('title', '')[:80]}",
                ))

                # Vincular a búsqueda si se indicó
                if search:
                    new_source = source or search.database_source or "desconocido"
                    sr = SearchReference(
                        search_id=search_id,
                        reference_id=ref.id,
                        source=new_source,
                        sources_json=json.dumps([new_source]),
                    )
                    db.add(sr)
                    db.flush()
                    linked += 1

        except Exception as e:
            # El SAVEPOINT se revirtió automáticamente; la transacción principal sigue intacta
            errors.append({"title": ref_data.get("title", "unknown")[:60], "error": str(e)})

    db.commit()

    return {
        "imported": imported,
        "total_parsed": len(refs),
        "linked_to_search": linked,
        "search_name": search.name if search else None,
        "source": source,
        "errors": errors,          # todos los errores, sin truncar
    }


@router.get("/status")
def import_status(db: Session = Depends(get_db)):
    """Total de referencias en BD y últimas 5 importaciones."""
    total = db.query(func.count(Reference.id)).scalar()
    recent_logs = (
        db.query(ChangeLog)
        .filter(ChangeLog.action == "import")
        .order_by(ChangeLog.created_at.desc())
        .limit(5)
        .all()
    )
    return {
        "total_references": total,
        "recent_imports": [
            {
                "id": log.id,
                "detail": log.detail,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in recent_logs
        ],
    }
