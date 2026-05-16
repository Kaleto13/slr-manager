"""
LLMClient — cliente multi-proveedor para Claude, GPT y Gemini.

Retorna siempre:
  {
    "content":       str,
    "usage": {
        "input_tokens":  int,
        "output_tokens": int,
    },
    "model":         str,
    "provider":      str,
  }

Sin retry automático: si hay error se lanza la excepción para que
el router la convierta en HTTPException 502.
"""

import os
import json
from pathlib import Path
from typing import Optional

# ── Cargar catálogo de modelos ────────────────────────────────────────────────
_MODELS_PATH = Path(__file__).parent.parent / "data" / "models.json"
try:
    with open(_MODELS_PATH, "r", encoding="utf-8") as f:
        _CATALOG: dict = json.load(f)
except FileNotFoundError:
    _CATALOG = {"models": {}, "exchange_rate": {"currency": "CLP", "rate": 950.0}}


def get_model_catalog() -> dict:
    return _CATALOG


def _estimate_tokens_chars(text: str) -> int:
    """Estimación rápida: ~4 chars por token (estándar para Anthropic/Google)."""
    return max(1, len(text) // 4)


# ── Claude (Anthropic) ────────────────────────────────────────────────────────

def _call_claude(prompt: str, model: str, system: Optional[str], max_tokens: int) -> dict:
    try:
        import anthropic
    except ImportError:
        raise RuntimeError("Paquete 'anthropic' no instalado. Ejecuta: pip install anthropic")

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY no configurada en .env")

    client = anthropic.Anthropic(api_key=api_key)

    kwargs = {
        "model":      model,
        "max_tokens": max_tokens,
        "messages":   [{"role": "user", "content": prompt}],
    }
    if system:
        kwargs["system"] = system

    response = client.messages.create(**kwargs)
    content  = response.content[0].text if response.content else ""
    usage    = response.usage

    return {
        "content":  content,
        "usage": {
            "input_tokens":  usage.input_tokens,
            "output_tokens": usage.output_tokens,
        },
        "model":    model,
        "provider": "anthropic",
    }


# ── GPT (OpenAI) ──────────────────────────────────────────────────────────────

def _call_gpt(prompt: str, model: str, system: Optional[str], max_tokens: int) -> dict:
    try:
        from openai import OpenAI
    except ImportError:
        raise RuntimeError("Paquete 'openai' no instalado. Ejecuta: pip install openai")

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY no configurada en .env")

    client   = OpenAI(api_key=api_key)
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    response = client.chat.completions.create(
        model=model, messages=messages, max_tokens=max_tokens
    )
    content = response.choices[0].message.content or ""
    usage   = response.usage

    return {
        "content":  content,
        "usage": {
            "input_tokens":  usage.prompt_tokens,
            "output_tokens": usage.completion_tokens,
        },
        "model":    model,
        "provider": "openai",
    }


# ── Gemini (Google) ───────────────────────────────────────────────────────────

def _call_gemini(prompt: str, model: str, system: Optional[str], max_tokens: int) -> dict:
    try:
        import google.generativeai as genai
    except ImportError:
        raise RuntimeError(
            "Paquete 'google-generativeai' no instalado. Ejecuta: pip install google-generativeai"
        )

    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY no configurada en .env")

    genai.configure(api_key=api_key)

    gen_cfg = genai.types.GenerationConfig(max_output_tokens=max_tokens)
    cfg     = {}
    if system:
        cfg["system_instruction"] = system

    gemini_model = genai.GenerativeModel(model_name=model, **cfg)
    response     = gemini_model.generate_content(prompt, generation_config=gen_cfg)
    content      = response.text or ""

    # Gemini devuelve usage en metadata (puede ser None en algunos modelos)
    try:
        meta = response.usage_metadata
        input_tokens  = meta.prompt_token_count  or _estimate_tokens_chars(prompt)
        output_tokens = meta.candidates_token_count or _estimate_tokens_chars(content)
    except Exception:
        input_tokens  = _estimate_tokens_chars(prompt)
        output_tokens = _estimate_tokens_chars(content)

    return {
        "content":  content,
        "usage": {
            "input_tokens":  input_tokens,
            "output_tokens": output_tokens,
        },
        "model":    model,
        "provider": "google",
    }


# ── Clase pública ─────────────────────────────────────────────────────────────

class LLMClient:
    """
    Cliente unificado multi-LLM.

    Uso:
        client = LLMClient()
        result = client.claude("Resume este abstract: ...")
        result = client.gpt("Resume este abstract: ...", model="gpt-4o-mini")
        result = client.gemini("Resume este abstract: ...")
    """

    def claude(
        self,
        prompt: str,
        model:      str            = "claude-sonnet-4-5",
        system:     Optional[str]  = None,
        max_tokens: int            = 1024,
    ) -> dict:
        return _call_claude(prompt, model, system, max_tokens)

    def gpt(
        self,
        prompt: str,
        model:      str           = "gpt-4o-mini",
        system:     Optional[str] = None,
        max_tokens: int           = 1024,
    ) -> dict:
        return _call_gpt(prompt, model, system, max_tokens)

    def gemini(
        self,
        prompt: str,
        model:      str           = "gemini-2.0-flash",
        system:     Optional[str] = None,
        max_tokens: int           = 1024,
    ) -> dict:
        return _call_gemini(prompt, model, system, max_tokens)

    def call(
        self,
        prompt: str,
        model:      str           = "claude-sonnet-4-5",
        system:     Optional[str] = None,
        max_tokens: int           = 1024,
    ) -> dict:
        """Llama al proveedor correcto según el modelo del catálogo."""
        info = _CATALOG.get("models", {}).get(model, {})
        provider = info.get("provider", "anthropic")
        if provider == "anthropic":
            return self.claude(prompt, model, system, max_tokens)
        elif provider == "openai":
            return self.gpt(prompt, model, system, max_tokens)
        elif provider == "google":
            return self.gemini(prompt, model, system, max_tokens)
        else:
            raise ValueError(f"Proveedor desconocido para modelo '{model}': {provider}")
