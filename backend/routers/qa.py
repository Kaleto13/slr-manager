"""
Router: Q&A sobre PDFs

POST /qa/{ref_id}          → pregunta sobre un PDF específico
GET  /qa/{ref_id}          → historial de preguntas de una referencia
DELETE /qa/{qa_id}         → eliminar una respuesta
POST /qa/batch             → pregunta a todos los PDFs de una búsqueda
GET  /qa/batch/{search_id} → historial batch de una búsqueda
GET  /qa/batch/{search_id}/export-csv → exportar resultados batch
"""

import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional

from database import get_db
from models.qa_response import QAResponse
from models.reference   import Reference
from models.search_reference import SearchReference
from models.paper_text  import PaperText
from services.qa_engine import answer_question, batch_qa
from services.cost_tracker import estimate_cost

router = APIRouter(prefix="/qa", tags=["qa"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class AskRequest(BaseModel):
    question:   str
    model:      str  = "claude-sonnet-4-5"
    max_tokens: int  = Field(default=1024, ge=1, le=4096)
    system:     Optional[str] = None


class BatchRequest(BaseModel):
    search_id:  int
    question:   str
    model:      str = "claude-sonnet-4-5"
    max_tokens: int = Field(default=1024, ge=1, le=4096)


class EstimateRequest(BaseModel):
    search_id:    int
    question:     str
    model:        str = "claude-sonnet-4-5"
    output_tokens: int = 800


# ── Endpoints por referencia ──────────────────────────────────────────────────

@router.post("/{ref_id}")
def ask_ref(ref_id: int, body: AskRequest, db: Session = Depends(get_db)):
    """Hace una pregunta sobre el PDF de una referencia específica."""
    try:
        result = answer_question(
            reference_id = ref_id,
            question     = body.question,
            model        = body.model,
            db           = db,
            max_tokens   = body.max_tokens,
            system       = body.system,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error inesperado: {e}")


@router.get("/{ref_id}")
def get_qa_history(
    ref_id: int,
    limit:  int = Query(50, description="Máx de respuestas a devolver"),
    db: Session = Depends(get_db),
):
    """Devuelve el historial de Q&A de una referencia."""
    rows = (
        db.query(QAResponse)
        .filter(QAResponse.reference_id == ref_id)
        .order_by(QAResponse.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id":            r.id,
            "question":      r.question,
            "answer":        r.answer,
            "model_name":    r.model_name,
            "cost_usd":      r.cost_usd,
            "input_tokens":  r.input_tokens,
            "output_tokens": r.output_tokens,
            "created_at":    r.created_at,
        }
        for r in rows
    ]


@router.delete("/response/{qa_id}")
def delete_qa(qa_id: int, db: Session = Depends(get_db)):
    """Elimina una respuesta del historial."""
    record = db.query(QAResponse).filter(QAResponse.id == qa_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Respuesta no encontrada")
    db.delete(record)
    db.commit()
    return {"deleted": True, "qa_id": qa_id}


# ── Estimación de costo batch ─────────────────────────────────────────────────

@router.post("/batch/estimate")
def estimate_batch_cost(body: EstimateRequest, db: Session = Depends(get_db)):
    """
    Estima el costo de una pregunta batch (sin ejecutar nada).
    Cuenta cuántas refs tienen texto y estima el costo por prompt+texto.
    """
    count = (
        db.query(PaperText)
        .join(SearchReference, SearchReference.reference_id == PaperText.reference_id)
        .filter(
            SearchReference.search_id == body.search_id,
            PaperText.plain_text.isnot(None),
            PaperText.plain_text != "",
        )
        .count()
    )

    if count == 0:
        return {"refs_with_text": 0, "estimated_cost_usd": 0, "estimated_cost_local": 0}

    # Estimación por ref: prompt = pregunta + ~5000 chars de texto
    sample_prompt = body.question + " " * 5000
    per_ref       = estimate_cost(body.model, sample_prompt, body.output_tokens)
    total_usd     = round(per_ref["cost_usd"] * count, 6)
    total_local   = round(per_ref["cost_local"] * count, 2)

    return {
        "refs_with_text":        count,
        "cost_per_ref_usd":      per_ref["cost_usd"],
        "estimated_cost_usd":    total_usd,
        "estimated_cost_local":  total_local,
        "currency":              per_ref["currency"],
        "model":                 body.model,
    }


# ── Endpoints batch ───────────────────────────────────────────────────────────

@router.post("/batch")
def ask_batch(body: BatchRequest, db: Session = Depends(get_db)):
    """
    Hace la misma pregunta a todos los PDFs con texto de una búsqueda.
    ⚠ Operación sincrónica — puede tardar varios minutos si hay muchas refs.
    """
    try:
        result = batch_qa(
            search_id  = body.search_id,
            question   = body.question,
            model      = body.model,
            db         = db,
            max_tokens = body.max_tokens,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/batch/{search_id}")
def get_batch_history(
    search_id: int,
    question:  Optional[str] = Query(None, description="Filtrar por pregunta exacta"),
    limit:     int            = Query(200),
    db: Session = Depends(get_db),
):
    """
    Devuelve todas las respuestas Q&A de las refs de una búsqueda,
    agrupadas por pregunta.
    """
    ref_ids = [
        r[0] for r in
        db.query(SearchReference.reference_id)
        .filter(SearchReference.search_id == search_id)
        .all()
    ]
    if not ref_ids:
        return {"questions": [], "total": 0}

    query = (
        db.query(QAResponse, Reference)
        .join(Reference, Reference.id == QAResponse.reference_id)
        .filter(QAResponse.reference_id.in_(ref_ids))
    )
    if question:
        query = query.filter(QAResponse.question == question)

    rows = query.order_by(QAResponse.created_at.desc()).limit(limit).all()

    return {
        "total": len(rows),
        "results": [
            {
                "id":           r.id,
                "reference_id": r.reference_id,
                "ref_title":    ref.title,
                "question":     r.question,
                "answer":       r.answer,
                "model_name":   r.model_name,
                "cost_usd":     r.cost_usd,
                "created_at":   r.created_at,
            }
            for r, ref in rows
        ],
    }


@router.get("/batch/{search_id}/export-csv")
def export_batch_csv(
    search_id: int,
    question:  Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Exporta los resultados batch como CSV con delimitador |."""
    data = get_batch_history(search_id, question=question, limit=10000, db=db)
    rows = data["results"]

    if not rows:
        raise HTTPException(status_code=404, detail="No hay respuestas para exportar")

    output = io.StringIO()
    writer = csv.writer(output, delimiter="|", quoting=csv.QUOTE_ALL)
    writer.writerow(["ID_Ref", "Título", "Pregunta", "Respuesta", "Modelo", "Costo_USD", "Fecha"])

    for r in rows:
        writer.writerow([
            r["reference_id"],
            r["ref_title"] or "",
            r["question"],
            r["answer"] or "",
            r["model_name"] or "",
            r["cost_usd"] or 0,
            r["created_at"].isoformat() if r["created_at"] else "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=qa_batch_{search_id}.csv"},
    )
