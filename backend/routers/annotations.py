"""
Router: Anotaciones de PDF

POST   /annotations                 → crear anotación
GET    /annotations/{ref_id}        → listar anotaciones de una referencia
PUT    /annotations/{ann_id}        → editar comentario / tag
DELETE /annotations/{ann_id}        → borrar anotación
GET    /annotations/{ref_id}/tags   → tags usados (para autocompletar)
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from database import get_db
from models.annotation import Annotation

router = APIRouter(prefix="/annotations", tags=["annotations"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class AnnotationCreate(BaseModel):
    reference_id: int
    page:         Optional[int]   = None
    text:         Optional[str]   = None   # texto seleccionado
    comment:      str                      # comentario del usuario
    tag:          Optional[str]   = None

class AnnotationUpdate(BaseModel):
    comment: Optional[str] = None
    tag:     Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(a: Annotation) -> dict:
    return {
        "id":           a.id,
        "reference_id": a.reference_id,
        "page":         a.page,
        "text":         a.text,
        "comment":      a.comment,
        "tag":          a.tag,
        "created_at":   a.created_at.isoformat() if a.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_annotation(body: AnnotationCreate, db: Session = Depends(get_db)):
    """Crea una nueva anotación vinculada a una referencia."""
    ann = Annotation(
        reference_id = body.reference_id,
        page         = body.page,
        text         = body.text,
        comment      = body.comment,
        tag          = body.tag,
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return _serialize(ann)


@router.get("/{ref_id}")
def list_annotations(ref_id: int, db: Session = Depends(get_db)):
    """Lista todas las anotaciones de una referencia, ordenadas por página."""
    anns = (
        db.query(Annotation)
        .filter(Annotation.reference_id == ref_id)
        .order_by(Annotation.page.asc().nullslast(), Annotation.created_at.asc())
        .all()
    )
    return [_serialize(a) for a in anns]


@router.put("/{ann_id}")
def update_annotation(ann_id: int, body: AnnotationUpdate, db: Session = Depends(get_db)):
    """Actualiza comentario y/o tag de una anotación."""
    ann = db.query(Annotation).filter(Annotation.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Anotación no encontrada")
    if body.comment is not None:
        ann.comment = body.comment
    if body.tag is not None:
        ann.tag = body.tag
    db.commit()
    db.refresh(ann)
    return _serialize(ann)


@router.delete("/{ann_id}", status_code=204)
def delete_annotation(ann_id: int, db: Session = Depends(get_db)):
    """Borra una anotación."""
    ann = db.query(Annotation).filter(Annotation.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Anotación no encontrada")
    db.delete(ann)
    db.commit()


@router.get("/{ref_id}/tags")
def get_tags(ref_id: int, db: Session = Depends(get_db)):
    """
    Retorna los tags distintos usados en las anotaciones de una referencia.
    Útil para autocompletar en el formulario de nueva anotación.
    """
    rows = db.execute(
        text("""
            SELECT DISTINCT tag FROM annotations
            WHERE reference_id = :rid AND tag IS NOT NULL AND tag != ''
            ORDER BY tag
        """),
        {"rid": ref_id}
    ).fetchall()
    return [r[0] for r in rows]
