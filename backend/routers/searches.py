"""
Router: Gestión de búsquedas
POST /searches              → crear búsqueda
GET  /searches              → listar búsquedas
GET  /searches/{id}/terms   → términos de una búsqueda
GET  /searches/{id}/references → referencias de una búsqueda (paginadas)
"""

import re
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models.search import Search
from models.search_term import SearchTerm
from models.search_reference import SearchReference
from models.reference import Reference

router = APIRouter(prefix="/searches", tags=["searches"])


# ── Schemas ────────────────────────────────────────────────────

class SearchCreate(BaseModel):
    name: str
    database_source: Optional[str] = None
    search_date: Optional[date] = None
    boolean_string: Optional[str] = None
    notes: Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────

def extract_terms(boolean_string: str) -> list[str]:
    """
    Extrae términos individuales de un boolean string.
    Elimina operadores (AND, OR, NOT) y paréntesis.
    Ejemplo: '("machine learning" OR "deep learning") AND "systematic review"'
    → ['machine learning', 'deep learning', 'systematic review']
    """
    if not boolean_string:
        return []
    # Extraer contenido entre comillas
    quoted = re.findall(r'"([^"]+)"', boolean_string)
    if quoted:
        return [t.strip() for t in quoted if t.strip()]
    # Si no hay comillas, dividir por operadores booleanos
    cleaned = re.sub(r'\b(AND|OR|NOT)\b', ' ', boolean_string, flags=re.IGNORECASE)
    cleaned = re.sub(r'[()[\]]', ' ', cleaned)
    terms = [t.strip() for t in cleaned.split() if len(t.strip()) > 2]
    return list(dict.fromkeys(terms))  # Deduplicar manteniendo orden


# ── Endpoints ──────────────────────────────────────────────────

@router.post("")
def create_search(payload: SearchCreate, db: Session = Depends(get_db)):
    """Crea una búsqueda y extrae sus términos del boolean_string."""
    # Verificar nombre único
    existing = db.query(Search).filter(Search.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Ya existe una búsqueda con el nombre '{payload.name}'")

    search = Search(
        name=payload.name,
        database_source=payload.database_source,
        search_date=payload.search_date,
        boolean_string=payload.boolean_string,
        notes=payload.notes,
    )
    db.add(search)
    db.flush()

    # Extraer y guardar términos
    terms = extract_terms(payload.boolean_string or "")
    for term in terms:
        db.add(SearchTerm(search_id=search.id, term=term))

    db.commit()
    db.refresh(search)

    return {
        "id": search.id,
        "name": search.name,
        "database_source": search.database_source,
        "terms_extracted": terms,
        "created_at": search.created_at.isoformat() if search.created_at else None,
    }


@router.get("")
def list_searches(db: Session = Depends(get_db)):
    """Lista todas las búsquedas con conteo de referencias."""
    searches = db.query(Search).order_by(Search.created_at.desc()).all()

    result = []
    for s in searches:
        ref_count = db.query(func.count(SearchReference.id)).filter(
            SearchReference.search_id == s.id
        ).scalar()
        term_count = db.query(func.count(SearchTerm.id)).filter(
            SearchTerm.search_id == s.id
        ).scalar()

        # Desglose por fuente: {Scopus: 12, WoS: 8, ...}
        source_rows = (
            db.query(SearchReference.source, func.count(SearchReference.id))
            .filter(SearchReference.search_id == s.id)
            .group_by(SearchReference.source)
            .all()
        )
        sources_breakdown = {
            (row[0] or "Sin fuente"): row[1] for row in source_rows
        }

        result.append({
            "id": s.id,
            "name": s.name,
            "database_source": s.database_source,
            "search_date": s.search_date.isoformat() if s.search_date else None,
            "boolean_string": s.boolean_string,
            "notes": s.notes,
            "reference_count": ref_count,
            "term_count": term_count,
            "sources_breakdown": sources_breakdown,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    return result


@router.delete("/{search_id}")
def delete_search(search_id: int, db: Session = Depends(get_db)):
    """Elimina una búsqueda y sus vínculos (search_references). No elimina las referencias."""
    search = db.query(Search).filter(Search.id == search_id).first()
    if not search:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")

    name = search.name
    # Los vínculos en search_references se eliminan por CASCADE (ondelete="CASCADE")
    # Los términos en search_terms también tienen CASCADE
    db.delete(search)
    db.commit()
    return {"deleted": True, "id": search_id, "name": name}


@router.get("/{search_id}/terms")
def get_search_terms(search_id: int, db: Session = Depends(get_db)):
    """Retorna los términos de una búsqueda."""
    search = db.query(Search).filter(Search.id == search_id).first()
    if not search:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")

    terms = db.query(SearchTerm).filter(SearchTerm.search_id == search_id).all()
    return {
        "search_id": search_id,
        "search_name": search.name,
        "terms": [{"id": t.id, "term": t.term} for t in terms],
    }


@router.get("/{search_id}/references")
def get_search_references(
    search_id: int,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """Retorna las referencias asociadas a una búsqueda, paginadas."""
    search = db.query(Search).filter(Search.id == search_id).first()
    if not search:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")

    query = (
        db.query(Reference)
        .join(SearchReference, SearchReference.reference_id == Reference.id)
        .filter(SearchReference.search_id == search_id)
    )
    total = query.count()
    refs = query.offset(skip).limit(limit).all()

    return {
        "search_id": search_id,
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
            }
            for r in refs
        ],
    }
