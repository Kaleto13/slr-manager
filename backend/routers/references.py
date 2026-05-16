"""
Router: Gestión de referencias
GET  /references               → listar todas (con filtro, paginación)
GET  /references?search_id=X   → listar referencias de una búsqueda específica
POST /references/download-oa   → descargar PDFs OA disponibles (Unpaywall)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from database import get_db
from models.reference import Reference
from models.search_reference import SearchReference
from models.paper_text import PaperText
from models.screening import ScreeningDecision
from services.oa_downloader import bulk_download_oa
from typing import Optional

router = APIRouter(prefix="/references", tags=["references"])


# ── Endpoints ──────────────────────────────────────────────────

@router.post("/download-oa")
def download_open_access(
    search_id: int,
    batch_limit: int = 100,
    db: Session = Depends(get_db),
):
    """
    Para las referencias de una búsqueda sin PDF:
    verifica disponibilidad OA en Unpaywall y descarga los PDFs encontrados.

    - search_id: ID de la búsqueda
    - batch_limit: máx de referencias a verificar en esta llamada (default 100)
    """
    # Verificar que la búsqueda existe
    from models.search import Search
    search = db.query(Search).filter(Search.id == search_id).first()
    if not search:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")

    try:
        stats = bulk_download_oa(search_id=search_id, db=db, batch_limit=batch_limit)
        return {
            "search_id": search_id,
            "search_name": search.name,
            **stats,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error durante descarga OA: {str(e)}")


@router.get("")
def list_references(
    search_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 10,
    db: Session = Depends(get_db),
):
    """
    Lista referencias. Si se proporciona search_id, retorna refs de esa búsqueda.
    Con paginación (skip, limit).
    """
    if search_id:
        # Referencias de una búsqueda específica
        query = (
            db.query(Reference)
            .join(SearchReference, SearchReference.reference_id == Reference.id)
            .filter(SearchReference.search_id == search_id)
        )
    else:
        # Todas las referencias
        query = db.query(Reference)

    total = query.count()
    refs = query.order_by(Reference.created_at.desc()).offset(skip).limit(limit).all()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "references": [
            {
                "id": r.id,
                "title": r.title,
                "authors": r.authors,
                "year": r.year,
                "doi": r.doi,
                "journal": r.journal,
                "url": r.url,
                "abstract": r.abstract,
                "keywords": r.keywords,
                "pdf_file": r.pdf_file,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in refs
        ],
    }


@router.get("/{search_id}/list")
def list_refs_for_pdf_manager(
    search_id: int,
    only_included: bool = Query(False, description="Si True, devuelve solo refs con decisión 'include' o 'maybe' en title_abstract"),
    db: Session = Depends(get_db),
):
    """
    Lista referencias de una búsqueda con estado de PDF y texto extraído.
    Usado por PDFDownloader (sin paginación, respuesta liviana).
    - only_included=true → solo refs con decisión 'include' (incluidas) o 'maybe' (a revisar)
    """
    query = (
        db.query(Reference)
        .join(SearchReference, SearchReference.reference_id == Reference.id)
        .filter(SearchReference.search_id == search_id)
    )

    if only_included:
        # Solo refs con decisión 'include' (incluida) o 'maybe' (a revisar) en title_abstract
        included_subq = (
            db.query(ScreeningDecision.reference_id)
            .filter(
                ScreeningDecision.search_id == search_id,
                ScreeningDecision.phase == "title_abstract",
                ScreeningDecision.decision.in_(["include", "maybe"]),
            )
            .subquery()
        )
        query = query.filter(Reference.id.in_(included_subq))

    refs = query.order_by(Reference.year.desc().nullslast(), Reference.id).all()

    # Textos extraídos de este conjunto
    ref_ids = [r.id for r in refs]
    text_map: dict = {}
    if ref_ids:
        texts = db.query(PaperText).filter(PaperText.reference_id.in_(ref_ids)).all()
        text_map = {t.reference_id: t for t in texts}

    return [
        {
            "id":         r.id,
            "title":      r.title,
            "authors":    r.authors,
            "year":       r.year,
            "doi":        r.doi,
            "journal":    r.journal,
            "url":        r.url,
            "has_pdf":    bool(r.pdf_file),
            "has_text":   r.id in text_map and bool(text_map[r.id].plain_text),
            "char_count": text_map[r.id].char_count if r.id in text_map else 0,
        }
        for r in refs
    ]


@router.get("/{reference_id}")
def get_reference(
    reference_id: int,
    db: Session = Depends(get_db),
):
    """Obtiene detalles de una referencia específica."""
    ref = db.query(Reference).filter(Reference.id == reference_id).first()
    if not ref:
        raise HTTPException(status_code=404, detail="Referencia no encontrada")

    return {
        "id": ref.id,
        "title": ref.title,
        "authors": ref.authors,
        "year": ref.year,
        "doi": ref.doi,
        "journal": ref.journal,
        "url": ref.url,
        "abstract": ref.abstract,
        "keywords": ref.keywords,
        "pdf_file": ref.pdf_file,
        "created_at": ref.created_at.isoformat() if ref.created_at else None,
    }
