"""
Parser de archivos .bib (BibTeX) para SLR-Manager.
Soporta archivos exportados desde WoS, Scopus, Google Scholar, etc.
Usa bibtexparser v1.4.
"""

import re
import json
import unicodedata
import bibtexparser
from bibtexparser.bparser import BibTexParser
from bibtexparser.customization import (
    convert_to_unicode,
    author,
    keyword,
)
from typing import List, Dict, Any


# ── Preprocesado de citation keys problemáticas ────────────────

def _ascii_safe(text: str) -> str:
    """Convierte caracteres acentuados a su equivalente ASCII (é→e, ñ→n, ş→s…)."""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _preprocess_bib_content(content: str) -> str:
    """
    Normaliza las citation keys del contenido .bib antes de pasarlo a bibtexparser.

    Scopus y otros exportadores generan citation keys con espacios, acentos o
    caracteres Unicode (p.ej. "de Oliveira Santos2024", "Muñoz Veloza202262").
    bibtexparser v1 descarta silenciosamente esas entradas.

    Este preprocesado reemplaza cualquier carácter no-alfanumérico/guión en la
    citation key por guión bajo, haciendo la clave válida sin tocar los valores
    de los campos.
    """
    def _sanitize_key(match: re.Match) -> str:
        entry_type = match.group(1)          # p.ej. "article"
        raw_key    = match.group(2).strip()  # p.ej. "de Oliveira Santos2024"
        ascii_key  = _ascii_safe(raw_key)    # accents → ASCII
        clean_key  = re.sub(r"[^\w\-]", "_", ascii_key)   # spaces/special → _
        clean_key  = re.sub(r"_+", "_", clean_key).strip("_")  # colapsar __
        return f"@{entry_type}{{{clean_key},"

    # Regex: @TIPO{ clave , — la clave es todo hasta la primera coma sin newlines
    # Usa lookahead para no consumir la coma (la volvemos a poner en _sanitize_key)
    return re.sub(
        r"@(\w+)\s*\{\s*([^,\n{]+?)\s*,",
        _sanitize_key,
        content,
        flags=re.IGNORECASE | re.MULTILINE,
    )


# ── Normalización ──────────────────────────────────────────────

def normalize_title(title: str) -> str:
    """
    Normaliza un título para comparación en deduplicación.
    - Lowercase
    - Elimina caracteres especiales y espacios extra
    - Elimina LaTeX básico
    """
    if not title:
        return ""
    t = title.lower()
    # Eliminar comandos LaTeX simples: \textbf{...} → ..., {word} → word
    t = re.sub(r"\\[a-zA-Z]+\{([^}]*)\}", r"\1", t)
    t = re.sub(r"[{}]", "", t)
    # Eliminar puntuación excepto espacios
    t = re.sub(r"[^\w\s]", "", t)
    # Colapsar espacios
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _normalize_authors(authors_list: List[str]) -> tuple[str, str]:
    """
    Recibe lista de autores de bibtexparser.
    Retorna (authors_str, authors_json).
    - authors_str: "Apellido, N.; Apellido2, N2"
    - authors_json: lista JSON serializada
    """
    clean = []
    for a in authors_list:
        a = a.strip()
        if a:
            clean.append(a)
    authors_str = "; ".join(clean)
    authors_json = json.dumps(clean, ensure_ascii=False)
    return authors_str, authors_json


def _normalize_keywords(kw_raw: str) -> tuple[str, str]:
    """
    Normaliza keywords desde string crudo (separados por coma o punto y coma).
    Retorna (keywords_str, keywords_json).
    """
    if not kw_raw:
        return "", "[]"
    # Separar por coma o punto y coma
    parts = re.split(r"[;,]", kw_raw)
    clean = [k.strip() for k in parts if k.strip()]
    return ", ".join(clean), json.dumps(clean, ensure_ascii=False)


def _safe_int(value: Any) -> int | None:
    """Convierte a int de forma segura."""
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        return None


# ── Parser principal ───────────────────────────────────────────

def _bibtex_customizations(record):
    """Cadena de customizaciones de bibtexparser."""
    try:
        record = convert_to_unicode(record)
    except Exception:
        pass
    try:
        record = author(record)
    except Exception:
        pass
    try:
        record = keyword(record)
    except Exception:
        pass
    return record


def parse_bib_file(filepath: str) -> List[Dict[str, Any]]:
    """
    Parsea un archivo .bib y retorna una lista de dicts normalizados.

    Args:
        filepath: Ruta absoluta al archivo .bib

    Returns:
        Lista de dicts con campos:
        [title, title_normalized, authors, authors_json, year, doi,
         journal, url, abstract, keywords, keywords_json]

    Raises:
        FileNotFoundError: Si el archivo no existe
        ValueError: Si el archivo no tiene entradas válidas
    """
    parser = BibTexParser(common_strings=True)
    parser.customization = _bibtex_customizations
    parser.ignore_nonstandard_types = False

    try:
        with open(filepath, encoding="utf-8", errors="replace") as f:
            raw_content = f.read()
    except FileNotFoundError:
        raise FileNotFoundError(f"Archivo no encontrado: {filepath}")

    # ── Contar entradas en el archivo crudo (antes de parsear) ──
    raw_entry_count = len(re.findall(r"@\w+\s*\{", raw_content, re.IGNORECASE))

    # ── Preprocesar citation keys problemáticas ──────────────────
    clean_content = _preprocess_bib_content(raw_content)

    try:
        import io
        bib_database = bibtexparser.load(io.StringIO(clean_content), parser=parser)
    except Exception as e:
        raise ValueError(f"Error al leer el archivo .bib: {e}")

    entries = bib_database.entries
    if not entries:
        raise ValueError("El archivo .bib no contiene entradas válidas.")

    # ── Advertir si bibtexparser descartó entradas ───────────────
    parsed_count = len(entries)
    if parsed_count < raw_entry_count:
        dropped = raw_entry_count - parsed_count
        print(f"⚠️  bibtexparser descartó {dropped} entrada(s) de {raw_entry_count} "
              f"(posiblemente @string/@preamble o entradas malformadas tras el preprocesado).")

    results = []
    skipped = []
    for entry in entries:
        try:
            ref = _parse_entry(entry)
            results.append(ref)
        except Exception as e:
            key = entry.get('ID', 'unknown')
            skipped.append({"key": key, "error": str(e)})
            print(f"⚠️  Entry skipped ({key}): {e}")
            continue

    if skipped:
        print(f"⚠️  {len(skipped)} entrada(s) se saltaron por error de normalización: "
              f"{[s['key'] for s in skipped]}")

    return results


def _parse_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Convierte una entrada bibtex en dict normalizado."""

    # Título
    title_raw = entry.get("title", "").strip()
    title_clean = re.sub(r"[{}]", "", title_raw).strip()

    # Autores (bibtexparser los entrega como lista si se aplicó customization)
    authors_raw = entry.get("author", [])
    if isinstance(authors_raw, list):
        authors_str, authors_json = _normalize_authors(authors_raw)
    else:
        # Fallback: string crudo
        authors_str = str(authors_raw).strip()
        authors_json = json.dumps([authors_str], ensure_ascii=False)

    # Keywords (bibtexparser las entrega como lista si se aplicó keyword())
    kw_raw = entry.get("keyword", entry.get("keywords", ""))
    if isinstance(kw_raw, list):
        keywords_str = ", ".join(kw_raw)
        keywords_json = json.dumps(kw_raw, ensure_ascii=False)
    else:
        keywords_str, keywords_json = _normalize_keywords(str(kw_raw))

    return {
        "title": title_clean,
        "title_normalized": normalize_title(title_clean),
        "authors": authors_str,
        "authors_json": authors_json,
        "year": _safe_int(entry.get("year")),
        "doi": entry.get("doi", "").strip() or None,
        "journal": entry.get("journal", entry.get("booktitle", "")).strip() or None,
        "url": entry.get("url", entry.get("link", "")).strip() or None,
        "abstract": entry.get("abstract", "").strip() or None,
        "keywords": keywords_str or None,
        "keywords_json": keywords_json,
    }
