"""
pdf_text_extractor — extrae texto de PDFs usando PyMuPDF (fitz).

Funciones públicas:
    extract_text(pdf_path)          → str  (texto plano)
    extract_to_markdown(pdf_path)   → str  (markdown estructurado)
    is_scanned(pdf_path)            → bool (True si el PDF no tiene texto seleccionable)
"""

import re
from pathlib import Path
from typing import Optional

# PyMuPDF se importa como "fitz"
try:
    import fitz  # noqa: F401
    _FITZ_AVAILABLE = True
except ImportError:
    _FITZ_AVAILABLE = False


# ── Helpers ────────────────────────────────────────────────────────────────────

def _require_fitz():
    if not _FITZ_AVAILABLE:
        raise RuntimeError(
            "PyMuPDF no está instalado. Ejecuta: pip install pymupdf"
        )


def _clean_text(text: str) -> str:
    """Limpia texto extraído: colapsa espacios múltiples, elimina caracteres nulos."""
    text = text.replace("\x00", "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{3,}", "  ", text)
    return text.strip()


# ── API pública ────────────────────────────────────────────────────────────────

def is_scanned(pdf_path: str) -> bool:
    """
    Heurística rápida: si menos del 10% de las páginas tienen texto seleccionable,
    probablemente es un PDF escaneado.
    """
    _require_fitz()
    import fitz

    try:
        doc = fitz.open(pdf_path)
        if len(doc) == 0:
            return True

        pages_with_text = sum(
            1 for page in doc if page.get_text("text").strip()
        )
        doc.close()
        return (pages_with_text / len(doc)) < 0.1
    except Exception:
        return True


def extract_text(pdf_path: str) -> str:
    """
    Extrae texto plano de un PDF.

    - PDFs de texto: extrae todo el texto seleccionable.
    - PDFs escaneados: retorna mensaje "Requires OCR".
    - Errores de lectura: retorna mensaje de error.
    """
    _require_fitz()
    import fitz

    path = Path(pdf_path)
    if not path.exists():
        return f"[Error] Archivo no encontrado: {pdf_path}"

    try:
        doc = fitz.open(str(path))

        if len(doc) == 0:
            doc.close()
            return "[Error] PDF vacío o no legible."

        pages_text = []
        char_count = 0

        for page_num, page in enumerate(doc, start=1):
            text = page.get_text("text")
            if text.strip():
                char_count += len(text)
                pages_text.append(text)

        doc.close()

        if char_count < 50:
            return "[Requires OCR] Este PDF parece ser una imagen escaneada. No se puede extraer texto sin OCR."

        full_text = "\n".join(pages_text)
        return _clean_text(full_text)

    except Exception as e:
        return f"[Error] No se pudo extraer texto: {e}"


def extract_to_markdown(pdf_path: str) -> str:
    """
    Extrae texto de un PDF y lo formatea como Markdown estructurado.

    Heurísticas para identificar títulos/secciones:
    - Bloques de texto en MAYÚSCULAS con menos de 100 chars → H2
    - Bloques que empiezan con número + punto (1. Introducción) → H3
    - El resto → párrafos normales
    """
    _require_fitz()
    import fitz

    path = Path(pdf_path)
    if not path.exists():
        return f"[Error] Archivo no encontrado: {pdf_path}"

    try:
        doc = fitz.open(str(path))

        if len(doc) == 0:
            doc.close()
            return "[Error] PDF vacío o no legible."

        md_parts = []
        total_chars = 0

        for page_num, page in enumerate(doc, start=1):
            # Extraer bloques con posición y tamaño de fuente
            blocks = page.get_text("blocks")  # list of (x0,y0,x1,y1,text,block_no,block_type)

            page_parts = []
            for block in blocks:
                if len(block) < 5:
                    continue
                text = block[4].strip()
                if not text:
                    continue

                total_chars += len(text)
                lines = text.split("\n")
                first_line = lines[0].strip()

                # Heurística de encabezado
                is_all_caps = first_line.isupper() and 5 < len(first_line) < 100
                is_numbered = bool(re.match(r"^\d+[\.\)]\s+\w", first_line))

                if is_all_caps:
                    page_parts.append(f"\n## {first_line.title()}\n")
                    rest = " ".join(lines[1:]).strip()
                    if rest:
                        page_parts.append(rest)
                elif is_numbered:
                    page_parts.append(f"\n### {first_line}\n")
                    rest = " ".join(lines[1:]).strip()
                    if rest:
                        page_parts.append(rest)
                else:
                    para = " ".join(line.strip() for line in lines if line.strip())
                    page_parts.append(para)

            if page_parts:
                md_parts.append(f"\n---\n*Página {page_num}*\n\n" + "\n\n".join(page_parts))

        doc.close()

        if total_chars < 50:
            return "[Requires OCR] Este PDF parece ser una imagen escaneada."

        return _clean_text("\n".join(md_parts))

    except Exception as e:
        return f"[Error] No se pudo extraer texto: {e}"


def extract_summary_info(pdf_path: str) -> dict:
    """
    Extrae metadatos básicos + estadísticas del PDF.
    Útil para el frontend (páginas, chars, is_scanned, etc.)
    """
    _require_fitz()
    import fitz

    path = Path(pdf_path)
    if not path.exists():
        return {"error": "Archivo no encontrado", "ok": False}

    try:
        doc = fitz.open(str(path))
        meta = doc.metadata or {}
        n_pages = len(doc)

        total_chars = sum(len(page.get_text("text")) for page in doc)
        scanned = (total_chars / max(n_pages, 1)) < 50

        doc.close()

        return {
            "ok":         True,
            "pages":      n_pages,
            "char_count": total_chars,
            "is_scanned": scanned,
            "title_meta": meta.get("title", ""),
            "author_meta": meta.get("author", ""),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
