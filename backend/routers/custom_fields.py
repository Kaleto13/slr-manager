"""
Router: Extracción de datos — campos personalizados por búsqueda

GET    /extraction/{search_id}/fields       → listar campos de una búsqueda
POST   /extraction/{search_id}/fields       → crear campo
DELETE /extraction/fields/{field_id}        → eliminar campo
GET    /extraction/{search_id}/refs         → refs incluidas + sus valores (matriz)
POST   /extraction/values                   → upsert un valor (ref × campo)
GET    /extraction/{search_id}/export-csv   → exportar matriz a CSV
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional, List
import csv
import io
import json
from pydantic import BaseModel

from database import get_db
from models.custom_field import CustomField
from models.field_value import FieldValue
from models.reference import Reference
from models.search import Search
from models.search_reference import SearchReference
from models.screening import ScreeningDecision, ScreeningCriteria

router = APIRouter(prefix="/extraction", tags=["extraction"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class FieldCreate(BaseModel):
    name: str
    field_type: str = "text"          # text | number | boolean | select | multiselect
    options: Optional[List[str]] = None  # requerido para select / multiselect


class ValueUpsert(BaseModel):
    reference_id: int
    field_id: int
    value: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_included_refs(search_id: int, db: Session):
    """
    Devuelve (refs, phase) con los artículos que pasaron screening.
    Prioriza full_text; si no hay, usa title_abstract.
    """
    for phase in ("full_text", "title_abstract"):
        refs = (
            db.query(Reference)
            .join(SearchReference, SearchReference.reference_id == Reference.id)
            .join(
                ScreeningDecision,
                (ScreeningDecision.reference_id == Reference.id)
                & (ScreeningDecision.search_id == search_id)
                & (ScreeningDecision.phase == phase)
                & (ScreeningDecision.decision == "include"),
            )
            .filter(SearchReference.search_id == search_id)
            .order_by(Reference.year.desc().nullslast(), Reference.id)
            .all()
        )
        if refs:
            return refs, phase

    return [], None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{search_id}/fields")
def list_fields(search_id: int, db: Session = Depends(get_db)):
    """Lista los campos de extracción de una búsqueda."""
    fields = (
        db.query(CustomField)
        .filter(CustomField.search_id == search_id)
        .order_by(CustomField.id)
        .all()
    )
    return [_field_dict(f) for f in fields]


def _field_dict(f: CustomField) -> dict:
    """Serializa un CustomField, parseando options de JSON → list."""
    opts = None
    if f.options:
        try:
            opts = json.loads(f.options)
        except Exception:
            opts = []
    return {
        "id":         f.id,
        "name":       f.name,
        "field_type": f.field_type,
        "options":    opts or [],
    }


@router.post("/{search_id}/fields", status_code=201)
def create_field(search_id: int, body: FieldCreate, db: Session = Depends(get_db)):
    """Crea un campo de extracción para una búsqueda."""
    search = db.query(Search).filter(Search.id == search_id).first()
    if not search:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")
    valid_types = ("text", "number", "boolean", "select", "multiselect")
    if body.field_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"field_type debe ser uno de: {', '.join(valid_types)}")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="El nombre del campo no puede estar vacío")
    if body.field_type in ("select", "multiselect") and not body.options:
        raise HTTPException(status_code=400, detail="Los campos select/multiselect requieren al menos una opción")

    field = CustomField(
        search_id  = search_id,
        name       = body.name.strip(),
        field_type = body.field_type,
        options    = json.dumps(body.options) if body.options else None,
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return _field_dict(field)


@router.delete("/fields/{field_id}")
def delete_field(field_id: int, db: Session = Depends(get_db)):
    """Elimina un campo (y todos sus valores asociados vía CASCADE)."""
    field = db.query(CustomField).filter(CustomField.id == field_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Campo no encontrado")
    db.delete(field)
    db.commit()
    return {"deleted": True, "field_id": field_id}


@router.get("/{search_id}/refs")
def list_refs_with_values(search_id: int, db: Session = Depends(get_db)):
    """
    Devuelve las refs incluidas en screening junto con todos sus valores
    de extracción — la 'matriz de extracción' completa.
    """
    refs, phase = _get_included_refs(search_id, db)

    fields = (
        db.query(CustomField)
        .filter(CustomField.search_id == search_id)
        .order_by(CustomField.id)
        .all()
    )

    if not refs:
        return {
            "refs":   [],
            "fields": [_field_dict(f) for f in fields],
            "phase":  phase,
            "total":  0,
        }

    ref_ids   = [r.id for r in refs]
    field_ids = [f.id for f in fields]

    # Valores existentes
    values: list[FieldValue] = []
    if field_ids:
        values = (
            db.query(FieldValue)
            .filter(
                FieldValue.reference_id.in_(ref_ids),
                FieldValue.custom_field_id.in_(field_ids),
            )
            .all()
        )

    # Mapa {ref_id: {field_id: value}}
    val_map: dict = {}
    for v in values:
        val_map.setdefault(v.reference_id, {})[v.custom_field_id] = v.value

    # Criterios de screening aplicados a cada ref (para columnas binarias)
    all_criteria = db.query(ScreeningCriteria).order_by(ScreeningCriteria.id).all()
    decisions = (
        db.query(ScreeningDecision)
        .filter(
            ScreeningDecision.search_id == search_id,
            ScreeningDecision.phase == phase,
            ScreeningDecision.reference_id.in_(ref_ids),
        )
        .all()
    )
    # {ref_id: set(criterion_ids)}
    dec_criteria_map: dict = {}
    for d in decisions:
        ids = d.criterion_ids or ([d.criterion_id] if d.criterion_id else [])
        dec_criteria_map[d.reference_id] = set(ids)

    refs_out = []
    for ref in refs:
        applied = dec_criteria_map.get(ref.id, set())
        refs_out.append({
            "id":              ref.id,
            "title":           ref.title,
            "authors":         ref.authors,
            "year":            ref.year,
            "journal":         ref.journal,
            "doi":             ref.doi,
            "url":             ref.url,
            "abstract":        ref.abstract,
            "keywords":        ref.keywords,
            "has_pdf":         bool(ref.pdf_file),
            "values":          val_map.get(ref.id, {}),
            "criteria_applied": {str(c.id): (1 if c.id in applied else 0) for c in all_criteria},
        })

    return {
        "refs":     refs_out,
        "fields":   [_field_dict(f) for f in fields],
        "criteria": [{"id": c.id, "label": c.label, "type": c.type} for c in all_criteria],
        "phase":    phase,
        "total":    len(refs_out),
    }


@router.post("/values")
def upsert_value(body: ValueUpsert, db: Session = Depends(get_db)):
    """Inserta o actualiza el valor de un campo para una referencia."""
    field = db.query(CustomField).filter(CustomField.id == body.field_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Campo no encontrado")

    existing = (
        db.query(FieldValue)
        .filter(
            FieldValue.reference_id   == body.reference_id,
            FieldValue.custom_field_id == body.field_id,
        )
        .first()
    )

    if existing:
        existing.value = body.value
    else:
        existing = FieldValue(
            reference_id    = body.reference_id,
            custom_field_id = body.field_id,
            value           = body.value,
        )
        db.add(existing)

    db.commit()
    return {
        "ok":           True,
        "reference_id": body.reference_id,
        "field_id":     body.field_id,
        "value":        body.value,
    }


@router.get("/{search_id}/export-csv")
def export_csv(search_id: int, db: Session = Depends(get_db)):
    """Exporta la matriz de extracción completa como CSV."""
    refs, phase = _get_included_refs(search_id, db)

    fields = (
        db.query(CustomField)
        .filter(CustomField.search_id == search_id)
        .order_by(CustomField.id)
        .all()
    )

    if not refs:
        raise HTTPException(status_code=404, detail="No hay referencias incluidas para exportar")

    ref_ids   = [r.id for r in refs]
    field_ids = [f.id for f in fields]

    values: list[FieldValue] = []
    if field_ids:
        values = (
            db.query(FieldValue)
            .filter(
                FieldValue.reference_id.in_(ref_ids),
                FieldValue.custom_field_id.in_(field_ids),
            )
            .all()
        )
    val_map: dict = {}
    for v in values:
        val_map.setdefault(v.reference_id, {})[v.custom_field_id] = v.value

    output = io.StringIO()
    writer = csv.writer(output, delimiter='|', quoting=csv.QUOTE_ALL)

    # Cabecera
    header = ["ID", "Título", "Autores", "Año", "Revista", "DOI"] + [f.name for f in fields]
    writer.writerow(header)

    # Filas
    for ref in refs:
        row = [
            ref.id,
            ref.title or "",
            ref.authors or "",
            ref.year or "",
            ref.journal or "",
            ref.doi or "",
        ]
        for f in fields:
            row.append(val_map.get(ref.id, {}).get(f.id, ""))
        writer.writerow(row)

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=extraccion_{search_id}.csv"},
    )
