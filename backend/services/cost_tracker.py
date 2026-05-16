"""
CostTracker — estimación y registro de costos de llamadas LLM.

Pre-ejecución:
    estimate_cost(model_name, prompt_text, expected_output_tokens)
    → {usd, local_currency, currency, input_tokens_est, output_tokens}

Post-ejecución:
    log_usage(db, model_name, usage_dict, cost_usd)
    → TokenUsage (grabado en BD)

Resumen de sesión:
    get_session_costs(db)
    → {total_usd, total_local, currency, queries_count, token_summary, top_model}
"""

import hashlib
import json
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import func

from models.token_usage import TokenUsage

# ── Cargar catálogo ────────────────────────────────────────────────────────────
_MODELS_PATH = Path(__file__).parent.parent / "data" / "models.json"
try:
    with open(_MODELS_PATH, "r", encoding="utf-8") as f:
        _CATALOG: dict = json.load(f)
except FileNotFoundError:
    _CATALOG = {"models": {}, "exchange_rate": {"currency": "CLP", "rate": 950.0}}

_EXCHANGE_RATE: float = float(_CATALOG.get("exchange_rate", {}).get("rate", 950.0))
_CURRENCY:      str   = _CATALOG.get("exchange_rate", {}).get("currency", "CLP")
_MODELS:        dict  = _CATALOG.get("models", {})


def _get_model_prices(model_name: str) -> tuple[float, float]:
    """Retorna (input_cost_per_1k, output_cost_per_1k) en USD."""
    info = _MODELS.get(model_name)
    if not info:
        # Fallback genérico conservador
        return 0.003, 0.015
    return float(info["input_cost_per_1k"]), float(info["output_cost_per_1k"])


def _tokens_from_text(text: str) -> int:
    """Estimación rápida: ~4 chars = 1 token."""
    return max(1, len(text) // 4)


# ── API pública ────────────────────────────────────────────────────────────────

def estimate_cost(
    model_name:            str,
    prompt_text:           str,
    expected_output_tokens: int = 500,
) -> dict:
    """
    Estimación PRE-ejecución.
    No toca la BD; devuelve USD + moneda local.
    """
    input_tokens_est = _tokens_from_text(prompt_text)
    in_cost, out_cost = _get_model_prices(model_name)

    cost_usd = (
        input_tokens_est  * in_cost  / 1000
        + expected_output_tokens * out_cost / 1000
    )
    cost_local = round(cost_usd * _EXCHANGE_RATE, 2)

    model_info = _MODELS.get(model_name, {})

    return {
        "model":             model_name,
        "display_name":      model_info.get("display_name", model_name),
        "provider":          model_info.get("provider", "unknown"),
        "input_tokens_est":  input_tokens_est,
        "output_tokens_est": expected_output_tokens,
        "cost_usd":          round(cost_usd, 6),
        "cost_local":        cost_local,
        "currency":          _CURRENCY,
        "exchange_rate":     _EXCHANGE_RATE,
    }


def log_usage(
    db:         Session,
    model_name: str,
    usage:      dict,           # {"input_tokens": int, "output_tokens": int}
    cost_usd:   Optional[float] = None,
    prompt_hash: Optional[str]  = None,
) -> TokenUsage:
    """
    Registra uso POST-ejecución en la tabla token_usage.
    Si cost_usd es None, lo calcula a partir del catálogo.
    """
    input_tokens  = int(usage.get("input_tokens",  0))
    output_tokens = int(usage.get("output_tokens", 0))

    if cost_usd is None:
        in_cost, out_cost = _get_model_prices(model_name)
        cost_usd = (
            input_tokens  * in_cost  / 1000
            + output_tokens * out_cost / 1000
        )

    record = TokenUsage(
        model_name    = model_name,
        input_tokens  = input_tokens,
        output_tokens = output_tokens,
        cost_usd      = round(cost_usd, 8),
        prompt_hash   = prompt_hash,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_session_costs(db: Session) -> dict:
    """
    Estadísticas acumuladas de toda la sesión (toda la tabla token_usage).
    """
    rows = db.query(TokenUsage).all()

    if not rows:
        return {
            "total_usd":     0.0,
            "total_local":   0.0,
            "currency":      _CURRENCY,
            "queries_count": 0,
            "token_summary": {"input": 0, "output": 0, "total": 0},
            "top_model":     None,
            "by_model":      [],
        }

    total_usd    = sum(r.cost_usd      for r in rows)
    total_input  = sum(r.input_tokens  for r in rows)
    total_output = sum(r.output_tokens for r in rows)

    # Agrupar por modelo
    model_map: dict = {}
    for r in rows:
        if r.model_name not in model_map:
            model_map[r.model_name] = {
                "model":         r.model_name,
                "display_name":  _MODELS.get(r.model_name, {}).get("display_name", r.model_name),
                "queries":       0,
                "input_tokens":  0,
                "output_tokens": 0,
                "cost_usd":      0.0,
            }
        m = model_map[r.model_name]
        m["queries"]       += 1
        m["input_tokens"]  += r.input_tokens
        m["output_tokens"] += r.output_tokens
        m["cost_usd"]      += r.cost_usd

    by_model  = sorted(model_map.values(), key=lambda x: x["cost_usd"], reverse=True)
    top_model = by_model[0]["display_name"] if by_model else None

    # Redondear costos
    for m in by_model:
        m["cost_usd"]   = round(m["cost_usd"], 6)
        m["cost_local"] = round(m["cost_usd"] * _EXCHANGE_RATE, 2)

    return {
        "total_usd":     round(total_usd, 6),
        "total_local":   round(total_usd * _EXCHANGE_RATE, 2),
        "currency":      _CURRENCY,
        "queries_count": len(rows),
        "token_summary": {
            "input":  total_input,
            "output": total_output,
            "total":  total_input + total_output,
        },
        "top_model": top_model,
        "by_model":  by_model,
    }
