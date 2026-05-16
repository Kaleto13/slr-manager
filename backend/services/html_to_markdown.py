"""
html_to_markdown — convierte HTML de páginas académicas a Markdown limpio.

Usa trafilatura para extraer el contenido principal (filtrando nav, ads, etc.)
con fallback a html.parser si trafilatura no está instalado.

Función pública:
    html_to_markdown(html_content: str, url: str = "") → str
"""

import re


# ── Implementación con trafilatura ─────────────────────────────────────────────

def _trafilatura_convert(html_content: str, url: str) -> str | None:
    try:
        import trafilatura
        result = trafilatura.extract(
            html_content,
            url=url or None,
            include_tables=True,
            include_links=False,
            output_format="markdown",
            no_fallback=False,
        )
        return result
    except ImportError:
        return None
    except Exception:
        return None


# ── Fallback manual con html.parser ───────────────────────────────────────────

def _manual_convert(html_content: str) -> str:
    """Extractor muy básico que elimina tags HTML y limpia el texto."""
    from html.parser import HTMLParser

    SKIP_TAGS = {
        "script", "style", "nav", "header", "footer", "aside",
        "form", "button", "noscript", "iframe", "svg",
    }

    class _Extractor(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts: list[str] = []
            self._skip_depth = 0
            self._current_tag = ""

        def handle_starttag(self, tag, attrs):
            tag_lower = tag.lower()
            if tag_lower in SKIP_TAGS:
                self._skip_depth += 1
            self._current_tag = tag_lower
            if tag_lower in ("h1", "h2", "h3", "h4"):
                self.parts.append(f"\n{'#' * int(tag_lower[1])} ")
            elif tag_lower == "p":
                self.parts.append("\n\n")
            elif tag_lower in ("li",):
                self.parts.append("\n- ")

        def handle_endtag(self, tag):
            if tag.lower() in SKIP_TAGS and self._skip_depth > 0:
                self._skip_depth -= 1

        def handle_data(self, data):
            if self._skip_depth == 0:
                text = data.strip()
                if text:
                    self.parts.append(text + " ")

    parser = _Extractor()
    parser.feed(html_content)
    raw = "".join(parser.parts)
    return _clean_markdown(raw)


# ── Limpieza ───────────────────────────────────────────────────────────────────

def _clean_markdown(text: str) -> str:
    """Colapsa líneas vacías múltiples y normaliza espacios."""
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    text = re.sub(r"[ \t]{3,}", " ", text)
    return text.strip()


# ── API pública ────────────────────────────────────────────────────────────────

def html_to_markdown(html_content: str, url: str = "") -> str:
    """
    Convierte HTML a Markdown limpio extrayendo el contenido principal.

    Intenta con trafilatura primero (mejor calidad para páginas académicas).
    Si no está instalado o falla, usa un parser manual de fallback.

    Args:
        html_content: Contenido HTML como string
        url: URL de origen (ayuda a trafilatura a resolver links relativos)

    Returns:
        Texto en formato Markdown, o string vacío si no se pudo extraer.
    """
    if not html_content or not html_content.strip():
        return ""

    # Intento 1: trafilatura
    result = _trafilatura_convert(html_content, url)
    if result and len(result.strip()) > 50:
        return _clean_markdown(result)

    # Intento 2: parser manual
    result = _manual_convert(html_content)
    if result and len(result.strip()) > 50:
        return result

    return ""
