"""
Router: Costos LLM

GET  /costs/estimate   → estimación pre-ejecución
GET  /costs/session    → estadísticas acumuladas de la sesión
GET  /costs/models     → catálogo de modelos disponibles
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import date, datetime

from database import get_db
from services.cost_tracker import estimate_cost, get_session_costs
from services.llm_client import get_model_catalog

router = APIRouter(prefix="/costs", tags=["costs"])


@router.get("/estimate")
def cost_estimate(
    model:         str = Query(...,   description="Nombre del modelo, ej. claude-sonnet-4-5"),
    prompt:        str = Query(...,   description="Texto del prompt a enviar"),
    output_tokens: int = Query(500,   description="Tokens de salida esperados"),
):
    """
    Estimación de costo PRE-ejecución, sin tocar la BD.
    Útil para el modal de confirmación en el frontend.
    """
    return estimate_cost(
        model_name             = model,
        prompt_text            = prompt,
        expected_output_tokens = output_tokens,
    )


@router.get("/session")
def session_costs(db: Session = Depends(get_db)):
    """
    Estadísticas acumuladas de todos los usos registrados en token_usage.
    """
    return get_session_costs(db)


@router.get("/system-status")
def system_status(db: Session = Depends(get_db)):
    """
    Diagnóstico de sistema:
    - Antigüedad del tipo de cambio (alerta si > 5 días)
    - Tamaño de la base de datos PostgreSQL (alerta si > 80% de 500 MB)
    """
    catalog   = get_model_catalog()
    exchange  = catalog.get("exchange_rate", {})
    warnings  = []

    # ── 1. Tipo de cambio desactualizado ──────────────────────────────────────
    updated_at_str = exchange.get("updated_at", None)
    exchange_days_old = None
    if updated_at_str:
        try:
            updated_date  = date.fromisoformat(updated_at_str)
            exchange_days_old = (date.today() - updated_date).days
            if exchange_days_old > 5:
                warnings.append({
                    "type":    "exchange_rate_stale",
                    "level":   "warning",
                    "message": (
                        f"⚠️ El tipo de cambio ({exchange.get('currency','CLP')}/{exchange.get('rate','?')})"
                        f" lleva {exchange_days_old} días sin actualizar. "
                        f"Edita el archivo backend/data/models.json para actualizarlo."
                    ),
                    "days_old": exchange_days_old,
                })
        except ValueError:
            pass

    # ── 2. Tamaño de la base de datos ─────────────────────────────────────────
    db_size_mb   = None
    db_threshold = 500   # MB gratis en Supabase
    db_warn_pct  = 80    # % para mostrar advertencia

    try:
        row = db.execute(
            text("SELECT pg_database_size(current_database()) / 1024.0 / 1024.0 AS size_mb")
        ).fetchone()
        if row:
            db_size_mb  = round(float(row[0]), 1)
            usage_pct   = (db_size_mb / db_threshold) * 100
            if usage_pct >= db_warn_pct:
                level = "error" if usage_pct >= 95 else "warning"
                warnings.append({
                    "type":     "storage_high",
                    "level":    level,
                    "message":  (
                        f"{'🔴' if level == 'error' else '⚠️'} Base de datos al "
                        f"{usage_pct:.0f}% de capacidad "
                        f"({db_size_mb} MB / {db_threshold} MB). "
                        "Considera exportar y limpiar datos o contratar un plan pago."
                    ),
                    "size_mb":    db_size_mb,
                    "limit_mb":   db_threshold,
                    "usage_pct":  round(usage_pct, 1),
                })
    except Exception:
        pass   # Si no es Supabase / PostgreSQL, ignorar

    return {
        "ok":      len([w for w in warnings if w["level"] == "error"]) == 0,
        "warnings": warnings,
        "exchange_rate": {
            "currency":   exchange.get("currency", "CLP"),
            "rate":       exchange.get("rate", 0),
            "updated_at": updated_at_str,
            "days_old":   exchange_days_old,
        },
        "database": {
            "size_mb":   db_size_mb,
            "limit_mb":  db_threshold,
            "usage_pct": round((db_size_mb / db_threshold) * 100, 1) if db_size_mb else None,
        },
    }


@router.get("/models")
def list_models():
    """
    Catálogo de modelos disponibles con sus precios y límites.
    """
    catalog   = get_model_catalog()
    models    = catalog.get("models", {})
    exchange  = catalog.get("exchange_rate", {})

    models_list = [
        {
            "key":               key,
            "display_name":      info.get("display_name", key),
            "provider":          info.get("provider", "unknown"),
            "input_cost_per_1k": info.get("input_cost_per_1k", 0),
            "output_cost_per_1k":info.get("output_cost_per_1k", 0),
            "max_context_tokens":info.get("max_context_tokens", 0),
        }
        for key, info in models.items()
    ]

    return {
        "models":        models_list,
        "exchange_rate": exchange,
    }
