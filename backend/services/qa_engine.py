"""
QA Engine — responde preguntas sobre PDFs usando LLMs.

answer_question(reference_id, question, model, db)
    → {"answer": str, "cost_usd": float, "currency": str, "cost_local": float,
       "input_tokens": int, "output_tokens": int, "model": str}

batch_qa(search_id, question, model, db)
    → lista de resultados por referencia
"""

import logging
from typing import Optional
from sqlalchemy.orm import Session

from models.qa_response import QAResponse
from models.paper_text  import PaperText
from models.reference   import Reference
from models.search_reference import SearchReference
from services.llm_client   import LLMClient
from services.cost_tracker import log_usage, estimate_cost

logger = logging.getLogger(__name__)

# Máx de caracteres del texto que se envía al LLM
# (evita exceder el contexto del modelo y controla costos)
MAX_TEXT_CHARS = 80_000   # ~20k tokens aprox.

SYSTEM_PROMPT = (
    "Eres un asistente experto en revisión sistemática de literatura científica. "
    "Responde de forma precisa y concisa basándote únicamente en el texto proporcionado. "
    "Si la información no está en el texto, indícalo claramente. "
    "Responde siempre en el mismo idioma en que fue formulada la pregunta."
)


def _build_prompt(text: str, question: str) -> str:
    # Truncar si el texto supera el límite
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS] + "\n\n[... texto truncado por límite de contexto ...]"

    return (
        f"A continuación se presenta el texto completo de un artículo científico:\n\n"
        f"---\n{text}\n---\n\n"
        f"Pregunta: {question}"
    )


def _save_qa(
    db:            Session,
    reference_id:  int,
    question:      str,
    answer:        str,
    model_name:    str,
    cost_usd:      float,
    input_tokens:  int,
    output_tokens: int,
) -> QAResponse:
    record = QAResponse(
        reference_id  = reference_id,
        question      = question,
        answer        = answer,
        model_name    = model_name,
        cost_usd      = round(cost_usd, 8),
        input_tokens  = input_tokens,
        output_tokens = output_tokens,
    )
    db.add(record)
    # También loguear en token_usage para el widget de costos
    try:
        log_usage(
            db         = db,
            model_name = model_name,
            usage      = {"input_tokens": input_tokens, "output_tokens": output_tokens},
            cost_usd   = cost_usd,
        )
    except Exception as e:
        logger.warning(f"qa_engine: no se pudo loguear en token_usage: {e}")
    db.commit()
    db.refresh(record)
    return record


def answer_question(
    reference_id:  int,
    question:      str,
    model:         str,
    db:            Session,
    max_tokens:    int  = 1024,
    system:        Optional[str] = None,
) -> dict:
    """
    Responde una pregunta sobre el PDF de una referencia.

    Raises:
        ValueError  si no hay texto extraído para la referencia.
        RuntimeError si el LLM falla.
    """
    # Obtener texto del PDF
    paper = db.query(PaperText).filter(PaperText.reference_id == reference_id).first()
    if not paper or not paper.plain_text:
        raise ValueError(
            "No hay texto extraído para esta referencia. "
            "Descarga el PDF y extrae el texto primero (Paso: Descarga de PDFs)."
        )

    ref = db.query(Reference).filter(Reference.id == reference_id).first()
    ref_title = ref.title if ref else f"ref_{reference_id}"

    prompt = _build_prompt(paper.plain_text, question)
    sys    = system or SYSTEM_PROMPT

    client = LLMClient()
    result = client.call(prompt=prompt, model=model, system=sys, max_tokens=max_tokens)

    answer        = result["content"]
    input_tokens  = result["usage"]["input_tokens"]
    output_tokens = result["usage"]["output_tokens"]

    # Calcular costo real a partir de los tokens reales
    est       = estimate_cost(model, "", 0)   # sólo para obtener precios
    from services.cost_tracker import _get_model_prices, _EXCHANGE_RATE, _CURRENCY
    in_cost, out_cost = _get_model_prices(model)
    cost_usd  = (input_tokens * in_cost + output_tokens * out_cost) / 1000
    cost_local = round(cost_usd * _EXCHANGE_RATE, 4)

    # Guardar en BD
    record = _save_qa(
        db, reference_id, question, answer, model,
        cost_usd, input_tokens, output_tokens,
    )

    return {
        "id":            record.id,
        "reference_id":  reference_id,
        "ref_title":     ref_title,
        "question":      question,
        "answer":        answer,
        "model":         model,
        "cost_usd":      round(cost_usd, 6),
        "cost_local":    cost_local,
        "currency":      _CURRENCY,
        "input_tokens":  input_tokens,
        "output_tokens": output_tokens,
        "created_at":    record.created_at,
    }


def batch_qa(
    search_id:  int,
    question:   str,
    model:      str,
    db:         Session,
    max_tokens: int = 1024,
) -> dict:
    """
    Hace la misma pregunta a todos los PDFs con texto extraído de una búsqueda.

    Returns:
        {
          "total":     int,   # refs con texto disponible
          "processed": int,
          "results":   list[{reference_id, ref_title, answer, cost_usd, ...}],
          "errors":    list[{reference_id, ref_title, error}],
          "total_cost_usd": float,
        }
    """
    # Obtener refs de la búsqueda que tienen texto extraído
    rows = (
        db.query(Reference, PaperText)
        .join(SearchReference, SearchReference.reference_id == Reference.id)
        .join(PaperText,       PaperText.reference_id == Reference.id)
        .filter(
            SearchReference.search_id == search_id,
            PaperText.plain_text.isnot(None),
            PaperText.plain_text != "",
        )
        .order_by(Reference.year.desc().nullslast(), Reference.id)
        .all()
    )

    results  = []
    errors   = []
    total_cost = 0.0

    for ref, _ in rows:
        try:
            r = answer_question(
                reference_id = ref.id,
                question     = question,
                model        = model,
                db           = db,
                max_tokens   = max_tokens,
            )
            results.append(r)
            total_cost += r["cost_usd"]
        except Exception as e:
            logger.error(f"batch_qa: error en ref {ref.id}: {e}")
            errors.append({
                "reference_id": ref.id,
                "ref_title":    ref.title or f"ref_{ref.id}",
                "error":        str(e),
            })

    return {
        "total":          len(rows),
        "processed":      len(results),
        "results":        results,
        "errors":         errors,
        "total_cost_usd": round(total_cost, 6),
    }
