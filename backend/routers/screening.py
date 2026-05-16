"""
Router: /screening
Gestiona los dos pasos de screening del flujo PRISMA:
  - Ronda 1: título + abstract
  - Ronda 2: texto completo (solo refs incluidas en ronda 1)
"""
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models.screening import ScreeningCriteria, ScreeningDecision
from models.search import Search
from models.search_reference import SearchReference
from models.reference import Reference

router = APIRouter(prefix="/screening", tags=["screening"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CriteriaCreate(BaseModel):
    label: str
    description: Optional[str] = None
    type: str = "exclusion"   # "exclusion" | "inclusion"


class DecideBody(BaseModel):
    reference_id: int
    phase: str                            # "title_abstract" | "full_text"
    decision: str                         # "include" | "exclude" | "maybe" | "pending"
    criterion_id: Optional[int] = None    # deprecated — usar criterion_ids
    criterion_ids: List[int] = []         # múltiples criterios
    notes: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_search_or_404(search_id: int, db: Session) -> Search:
    s = db.query(Search).filter(Search.id == search_id).first()
    if not s:
        raise HTTPException(404, f"Búsqueda {search_id} no encontrada")
    return s


def _ref_ids_for_search(search_id: int, db: Session):
    """IDs de todas las referencias vinculadas a una búsqueda."""
    return (
        db.query(SearchReference.reference_id)
        .filter(SearchReference.search_id == search_id)
        .subquery()
    )


# ── Criterios de exclusión / inclusión ───────────────────────────────────────

@router.get("/criteria")
def list_criteria(db: Session = Depends(get_db)):
    return db.query(ScreeningCriteria).order_by(ScreeningCriteria.id).all()


@router.post("/criteria", status_code=201)
def create_criterion(body: CriteriaCreate, db: Session = Depends(get_db)):
    if body.type not in ("exclusion", "inclusion"):
        raise HTTPException(400, "type debe ser 'exclusion' o 'inclusion'")
    c = ScreeningCriteria(label=body.label, description=body.description, type=body.type)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.delete("/criteria/{criterion_id}", status_code=200)
def delete_criterion(criterion_id: int, db: Session = Depends(get_db)):
    c = db.query(ScreeningCriteria).filter(ScreeningCriteria.id == criterion_id).first()
    if not c:
        raise HTTPException(404, "Criterio no encontrado")
    db.delete(c)
    db.commit()
    return {"deleted": criterion_id}


# ── Estadísticas de screening ─────────────────────────────────────────────────

@router.get("/{search_id}/stats")
def get_stats(search_id: int, db: Session = Depends(get_db)):
    _get_search_or_404(search_id, db)
    ref_ids_sq = _ref_ids_for_search(search_id, db)

    total_refs = db.query(func.count(SearchReference.reference_id))\
        .filter(SearchReference.search_id == search_id).scalar()

    def phase_stats(phase: str):
        rows = (
            db.query(ScreeningDecision.decision, func.count(ScreeningDecision.id))
            .filter(
                ScreeningDecision.search_id == search_id,
                ScreeningDecision.phase == phase,
            )
            .group_by(ScreeningDecision.decision)
            .all()
        )
        counts = {r[0]: r[1] for r in rows}
        decided = sum(v for k, v in counts.items() if k != "pending")
        total_in_phase = sum(counts.values())
        return {
            "include": counts.get("include", 0),
            "exclude": counts.get("exclude", 0),
            "maybe":   counts.get("maybe", 0),
            "pending": counts.get("pending", 0),
            "total":   total_in_phase,
            "decided": decided,
        }

    r1 = phase_stats("title_abstract")
    r2 = phase_stats("full_text")

    # Ronda 1 iniciada = hay al menos una decisión en title_abstract para esta búsqueda
    round1_started = r1["total"] > 0

    # Refs incluidas en Ronda 1
    r1_included_count = db.query(func.count(ScreeningDecision.id)).filter(
        ScreeningDecision.search_id == search_id,
        ScreeningDecision.phase == "title_abstract",
        ScreeningDecision.decision == "include",
    ).scalar() or 0

    # Ronda 2 disponible = hay al menos una ref incluida en ronda 1
    round2_available = r1_included_count > 0

    # Refs incluidas en R1 que aún NO tienen entrada en R2 (pendientes de sincronizar)
    r2_ref_ids = db.query(ScreeningDecision.reference_id).filter(
        ScreeningDecision.search_id == search_id,
        ScreeningDecision.phase == "full_text",
    ).subquery()
    pending_sync = db.query(func.count(ScreeningDecision.id)).filter(
        ScreeningDecision.search_id == search_id,
        ScreeningDecision.phase == "title_abstract",
        ScreeningDecision.decision == "include",
        ScreeningDecision.reference_id.notin_(r2_ref_ids),
    ).scalar() or 0

    return {
        "total_refs": total_refs,
        "round1": r1,
        "round2": r2,
        "round1_started": round1_started,
        "round2_available": round2_available,
        "pending_sync": pending_sync,   # nuevos includes de R1 no sincronizados a R2
    }


# ── Inicializar ronda 1 ───────────────────────────────────────────────────────

@router.post("/{search_id}/init-round1", status_code=200)
def init_round1(search_id: int, db: Session = Depends(get_db)):
    """Crea entradas 'pending' en title_abstract para todas las refs de la búsqueda."""
    _get_search_or_404(search_id, db)

    ref_ids = [
        r[0] for r in
        db.query(SearchReference.reference_id)
        .filter(SearchReference.search_id == search_id)
        .all()
    ]

    created = 0
    for rid in ref_ids:
        exists = db.query(ScreeningDecision).filter(
            ScreeningDecision.search_id == search_id,
            ScreeningDecision.reference_id == rid,
            ScreeningDecision.phase == "title_abstract",
        ).first()
        if not exists:
            db.add(ScreeningDecision(
                search_id=search_id,
                reference_id=rid,
                phase="title_abstract",
                decision="pending",
            ))
            created += 1

    db.commit()
    return {"initialized": created, "total": len(ref_ids)}


# ── Inicializar ronda 2 (desde incluidos en ronda 1) ─────────────────────────

@router.post("/{search_id}/init-round2", status_code=200)
def init_round2(search_id: int, db: Session = Depends(get_db)):
    """Crea entradas 'pending' en full_text para refs incluidas en title_abstract."""
    _get_search_or_404(search_id, db)

    included_r1 = (
        db.query(ScreeningDecision.reference_id)
        .filter(
            ScreeningDecision.search_id == search_id,
            ScreeningDecision.phase == "title_abstract",
            ScreeningDecision.decision == "include",
        )
        .all()
    )
    ref_ids = [r[0] for r in included_r1]

    created = 0
    for rid in ref_ids:
        exists = db.query(ScreeningDecision).filter(
            ScreeningDecision.search_id == search_id,
            ScreeningDecision.reference_id == rid,
            ScreeningDecision.phase == "full_text",
        ).first()
        if not exists:
            db.add(ScreeningDecision(
                search_id=search_id,
                reference_id=rid,
                phase="full_text",
                decision="pending",
            ))
            created += 1

    db.commit()
    return {"initialized": created, "total": len(ref_ids)}


# ── Lista de referencias con decisiones ──────────────────────────────────────

@router.get("/{search_id}/refs")
def list_refs(
    search_id: int,
    phase:      str = Query("title_abstract"),
    decision:   str = Query("all"),     # "all"|"pending"|"include"|"exclude"|"maybe"
    page:       int = Query(1, ge=1),
    per_page:   int = Query(50, ge=1, le=200),
    q:          Optional[str] = Query(None, description="Buscar por título, autores o revista"),
    db: Session = Depends(get_db),
):
    _get_search_or_404(search_id, db)

    # Base query: refs linked to search + their screening decision (if any)
    query = (
        db.query(Reference, ScreeningDecision)
        .join(SearchReference, SearchReference.reference_id == Reference.id)
        .outerjoin(
            ScreeningDecision,
            (ScreeningDecision.reference_id == Reference.id)
            & (ScreeningDecision.search_id == search_id)
            & (ScreeningDecision.phase == phase),
        )
        .filter(SearchReference.search_id == search_id)
    )

    # Para ronda 2, solo mostrar refs que tienen una decisión en full_text
    if phase == "full_text":
        query = query.filter(ScreeningDecision.id.isnot(None))

    # Filtrar por decisión
    if decision != "all":
        if decision == "pending":
            # pending = decision == 'pending' OR no hay decisión aún
            from sqlalchemy import or_
            query = query.filter(
                or_(
                    ScreeningDecision.decision == "pending",
                    ScreeningDecision.id.is_(None),
                )
            )
        else:
            query = query.filter(ScreeningDecision.decision == decision)

    # Búsqueda por texto libre (título, autores, revista)
    if q and q.strip():
        term = f"%{q.strip()}%"
        from sqlalchemy import or_
        query = query.filter(
            or_(
                Reference.title.ilike(term),
                Reference.authors.ilike(term),
                Reference.journal.ilike(term),
            )
        )

    total = query.count()

    rows = (
        query.order_by(Reference.id)
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    criteria_map = _criteria_map(db)

    # For full_text phase, also fetch round-1 decisions for context
    r1_map: dict = {}
    if phase == "full_text":
        page_ref_ids = [ref.id for ref, _ in rows]
        if page_ref_ids:
            r1_rows = (
                db.query(ScreeningDecision.reference_id, ScreeningDecision.decision)
                .filter(
                    ScreeningDecision.search_id == search_id,
                    ScreeningDecision.phase == "title_abstract",
                    ScreeningDecision.reference_id.in_(page_ref_ids),
                )
                .all()
            )
            r1_map = {r[0]: r[1] for r in r1_rows}

    results = []
    for ref, dec in rows:
        results.append({
            "id":              ref.id,
            "title":           ref.title,
            "authors":         ref.authors,
            "year":            ref.year,
            "journal":         ref.journal,
            "abstract":        ref.abstract,
            "doi":             ref.doi,
            "has_pdf":         bool(ref.pdf_file),
            "decision":        dec.decision if dec else "pending",
            "criterion_ids":    (dec.criterion_ids or []) if dec else [],
            "criterion_labels": [criteria_map[i] for i in (dec.criterion_ids or []) if i in criteria_map] if dec else [],
            "notes":           dec.notes if dec else None,
            "decided_at":      dec.decided_at.isoformat() if dec and dec.decided_at else None,
            "r1_decision":     r1_map.get(ref.id) if phase == "full_text" else None,
        })

    return {
        "total": total,
        "page":  page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if total else 1,
        "refs":  results,
    }


# ── Registrar decisión ────────────────────────────────────────────────────────

def _criteria_map(db: Session) -> dict:
    return {c.id: c.label for c in db.query(ScreeningCriteria).all()}


@router.post("/{search_id}/decide", status_code=200)
def decide(search_id: int, body: DecideBody, db: Session = Depends(get_db)):
    _get_search_or_404(search_id, db)

    if body.phase not in ("title_abstract", "full_text"):
        raise HTTPException(400, "phase debe ser 'title_abstract' o 'full_text'")
    if body.decision not in ("include", "exclude", "maybe", "pending"):
        raise HTTPException(400, "decision inválida")

    dec = db.query(ScreeningDecision).filter(
        ScreeningDecision.search_id    == search_id,
        ScreeningDecision.reference_id == body.reference_id,
        ScreeningDecision.phase        == body.phase,
    ).first()

    now = datetime.now(timezone.utc) if body.decision != "pending" else None

    # Unificar: si viene criterion_ids úsalo; si viene criterion_id legacy, envuélvelo
    ids = body.criterion_ids if body.criterion_ids else (
        [body.criterion_id] if body.criterion_id else []
    )
    first_id = ids[0] if ids else None  # mantener criterion_id para compat

    if dec:
        dec.decision      = body.decision
        dec.criterion_id  = first_id
        dec.criterion_ids = ids
        dec.notes         = body.notes
        dec.decided_at    = now
    else:
        dec = ScreeningDecision(
            search_id     = search_id,
            reference_id  = body.reference_id,
            phase         = body.phase,
            decision      = body.decision,
            criterion_id  = first_id,
            criterion_ids = ids,
            notes         = body.notes,
            decided_at    = now,
        )
        db.add(dec)

    db.commit()
    db.refresh(dec)

    cmap      = _criteria_map(db)
    stored_ids = dec.criterion_ids or []
    return {
        "reference_id":    dec.reference_id,
        "phase":           dec.phase,
        "decision":        dec.decision,
        "criterion_ids":   stored_ids,
        "criterion_labels":[cmap[i] for i in stored_ids if i in cmap],
        "notes":           dec.notes,
    }
