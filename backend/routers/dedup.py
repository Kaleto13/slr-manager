"""
Router de deduplicación.

Endpoints:
  POST /dedup/find          — detectar duplicados (sin marcar)
  POST /dedup/mark          — marcar un par como duplicado
  POST /dedup/unmark        — desmarcar un par
  POST /dedup/mark-all      — detectar y marcar todo automáticamente
  GET  /dedup/report        — resumen de duplicados marcados
"""

import json
from collections import Counter
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db
from models.reference import Reference
from models.search_reference import SearchReference
from models.duplicate import Duplicate
from services.dedup_engine import (
    find_duplicates,
    find_duplicates_fuzzy,
    mark_duplicate,
    unmark_duplicate,
    mark_all_found,
    get_report,
)

router = APIRouter(prefix="/dedup", tags=["dedup"])


# ── Schemas ────────────────────────────────────────────────────

class MarkDuplicateRequest(BaseModel):
    reference_id: int
    canonical_id: int
    detection_method: str = "manual"


class UnmarkDuplicateRequest(BaseModel):
    reference_id: int
    canonical_id: int


# ── Endpoints ──────────────────────────────────────────────────

@router.post("/find")
def find_duplicates_endpoint(
    search_id: int | None = Query(None, description="Limitar a una búsqueda específica"),
    db: Session = Depends(get_db),
):
    """
    Detecta pares de referencias duplicadas (por DOI exacto o título normalizado).
    No modifica la BD — solo retorna los pares encontrados para revisión.
    """
    return find_duplicates(search_id=search_id, db=db)


@router.post("/find-fuzzy")
def find_duplicates_fuzzy_endpoint(
    search_id: int | None = Query(None, description="Limitar a una búsqueda específica"),
    threshold: int        = Query(90,   ge=50, le=100, description="Umbral de similitud (50-100). Recomendado: 85-95"),
    db: Session = Depends(get_db),
):
    """
    Detecta pares de referencias con títulos MUY similares usando rapidfuzz.
    Solo evalúa referencias SIN DOI (para complementar el find exacto).
    No modifica la BD — retorna pares para revisión manual.
    """
    return find_duplicates_fuzzy(search_id=search_id, db=db, threshold=threshold)


@router.post("/mark")
def mark_duplicate_endpoint(
    body: MarkDuplicateRequest,
    db: Session = Depends(get_db),
):
    """
    Marca una referencia como duplicado de otra.
    """
    result = mark_duplicate(
        reference_id=body.reference_id,
        canonical_id=body.canonical_id,
        detection_method=body.detection_method,
        db=db,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/unmark")
def unmark_duplicate_endpoint(
    body: UnmarkDuplicateRequest,
    db: Session = Depends(get_db),
):
    """
    Elimina la marca de duplicado (el usuario decidió que no son duplicados).
    """
    return unmark_duplicate(
        reference_id=body.reference_id,
        canonical_id=body.canonical_id,
        db=db,
    )


@router.post("/mark-all")
def mark_all_endpoint(
    search_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """
    Detecta y marca automáticamente todos los duplicados encontrados.
    Útil para aplicar deduplicación de una sola vez.
    """
    return mark_all_found(search_id=search_id, db=db)


@router.get("/report")
def report_endpoint(
    search_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """
    Resumen de duplicados: total, por método, tasa de duplicación.
    """
    return get_report(search_id=search_id, db=db)


@router.get("/sources")
def sources_report_endpoint(
    search_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """
    Análisis de fuentes: cuántos papers vienen de cada BD y cuáles están en varias.
    Útil para construir el diagrama PRISMA.
    """
    query = db.query(SearchReference)
    if search_id is not None:
        query = query.filter(SearchReference.search_id == search_id)

    rows = query.all()
    total = len(rows)

    # Contar por cada combinación de fuentes
    per_source: Counter = Counter()
    multi_source_count = 0
    source_only: dict[str, int] = {}  # fuente → refs que SOLO vienen de esa fuente

    for row in rows:
        try:
            sources = json.loads(row.sources_json or "[]")
        except Exception:
            sources = [row.source] if row.source else ["desconocido"]

        if not sources:
            sources = ["desconocido"]

        for s in sources:
            per_source[s] += 1

        if len(sources) > 1:
            multi_source_count += 1

    # Fuentes únicas detectadas
    all_sources = sorted(per_source.keys())

    # Refs que solo vienen de una fuente
    for row in rows:
        try:
            sources = json.loads(row.sources_json or "[]")
        except Exception:
            sources = [row.source] if row.source else ["desconocido"]
        if len(sources) == 1:
            s = sources[0]
            source_only[s] = source_only.get(s, 0) + 1

    return {
        "total_references": total,
        "sources_found": all_sources,
        "per_source_total": dict(per_source),
        "per_source_exclusive": source_only,
        "multi_source_references": multi_source_count,
    }


class RemoveDuplicateRequest(BaseModel):
    duplicate_id: int    # referencia a eliminar
    canonical_id: int    # referencia a conservar
    search_id: int       # búsqueda en la que se está operando


@router.delete("/remove")
def remove_duplicate_endpoint(
    body: RemoveDuplicateRequest,
    db: Session = Depends(get_db),
):
    """
    Elimina el duplicado de una búsqueda:
    1. Borra el vínculo search_references para (search_id, duplicate_id)
    2. Si la referencia ya no está en ninguna otra búsqueda Y no tiene PDF → la borra de references
    3. Limpia cualquier marca en la tabla duplicates

    La referencia canonical se conserva intacta.
    """
    dup_ref = db.query(Reference).filter(Reference.id == body.duplicate_id).first()
    if not dup_ref:
        raise HTTPException(status_code=404, detail=f"Referencia {body.duplicate_id} no encontrada")

    canonical_ref = db.query(Reference).filter(Reference.id == body.canonical_id).first()
    if not canonical_ref:
        raise HTTPException(status_code=404, detail=f"Referencia canónica {body.canonical_id} no encontrada")

    # 1. Borrar vínculo con esta búsqueda
    link = db.query(SearchReference).filter(
        SearchReference.search_id == body.search_id,
        SearchReference.reference_id == body.duplicate_id,
    ).first()
    if link:
        db.delete(link)
        db.flush()

    # 2. ¿Tiene la referencia otros vínculos en otras búsquedas?
    other_links = db.query(SearchReference).filter(
        SearchReference.reference_id == body.duplicate_id,
    ).count()

    deleted_from_db = False
    if other_links == 0:
        # Sin más vínculos → eliminar la referencia completa
        db.delete(dup_ref)
        deleted_from_db = True

    # 3. Limpiar marcas de duplicado
    db.query(Duplicate).filter(
        ((Duplicate.reference_id == body.duplicate_id) & (Duplicate.canonical_id == body.canonical_id)) |
        ((Duplicate.reference_id == body.canonical_id) & (Duplicate.canonical_id == body.duplicate_id))
    ).delete(synchronize_session=False)

    db.commit()

    return {
        "status": "removed",
        "duplicate_id": body.duplicate_id,
        "canonical_id": body.canonical_id,
        "deleted_from_db": deleted_from_db,
    }
