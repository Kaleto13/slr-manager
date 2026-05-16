"""
Servicio de importación asistida de PDFs.

Flujo:
  1. El frontend registra un timestamp de inicio y abre los DOIs en pestañas.
  2. El usuario descarga los PDFs manualmente desde el navegador.
  3. El frontend llama a /scan con {since, reference_ids} al terminar.
  4. Este servicio escanea la carpeta de Descargas (Downloads) buscando
     PDFs nuevos desde el timestamp y hace fuzzy matching contra los artículos.
  5. El frontend muestra los matches para confirmación.
  6. /confirm copia y registra los PDFs confirmados.
"""

import os
import time
import shutil
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

PDF_DIR = Path("data/PDFs")
PDF_DIR.mkdir(parents=True, exist_ok=True)


# ── Localizar carpeta Downloads ───────────────────────────────────────────────

def _find_downloads_folder() -> Path:
    """
    Detecta la carpeta de Descargas del usuario en Windows, Linux y macOS.
    Soporta la carpeta configurada en Windows Registry y rutas personalizadas.
    """
    # 1. Variable de entorno personalizada (para override en dev)
    env_dl = os.environ.get("SLR_DOWNLOADS_DIR")
    if env_dl:
        p = Path(env_dl)
        if p.exists():
            return p

    home = Path.home()

    # 2. Windows: intentar leer del Registry (Shell Folders)
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders",
        )
        val, _ = winreg.QueryValueEx(key, "{374DE290-123F-4565-9164-39C4925E467B}")
        winreg.CloseKey(key)
        p = Path(val)
        if p.exists():
            return p
    except Exception:
        pass

    # 3. Rutas estándar por plataforma
    candidates = [
        home / "Downloads",
        home / "Descargas",          # ES
        home / "Téléchargements",    # FR
        home / "Desktop",            # fallback
    ]
    for c in candidates:
        if c.exists():
            return c

    return home  # último recurso


# ── Extracción de título desde primera página ─────────────────────────────────

def _extract_title_from_pdf(pdf_path: Path) -> str:
    """
    Extrae el título probable de un PDF analizando la primera página.
    Usa varias heurísticas:
      1. Metadato 'title' del PDF (si existe y no está vacío)
      2. Primera línea larga (>20 chars) de la primera página
      3. Líneas en la zona superior de la página (top 30%)
    Devuelve string vacío si no se puede extraer.
    """
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(str(pdf_path))
        if not doc.page_count:
            return ""

        # 1. Metadato title
        meta_title = (doc.metadata or {}).get("title", "").strip()
        if meta_title and len(meta_title) > 15 and meta_title.lower() not in ("untitled", "unknown"):
            return meta_title

        # 2. Texto estructurado de la primera página
        page = doc[0]
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]

        page_height = page.rect.height
        top_zone    = page_height * 0.40   # zona superior 40% de la página

        # Recopilar spans en zona superior
        top_spans: list[dict] = []
        for block in blocks:
            if block.get("type") != 0:  # 0 = texto
                continue
            block_y = block["bbox"][1]  # y superior del bloque
            if block_y > top_zone:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "").strip()
                    if len(text) > 5:
                        top_spans.append({
                            "text":   text,
                            "size":   span.get("size", 0),
                            "bold":   "bold" in span.get("flags_str", "") or span.get("flags", 0) & 2,
                            "y":      span["origin"][1],
                        })

        if not top_spans:
            # Fallback: texto plano de primera página
            raw = page.get_text("text").strip()
            lines = [l.strip() for l in raw.splitlines() if len(l.strip()) > 20]
            return lines[0][:200] if lines else ""

        # Ordenar por tamaño de fuente (descendente) → candidatos de título
        top_spans.sort(key=lambda s: (-s["size"], s["y"]))

        # Agrupar spans consecutivos con tamaño similar (puede ser el título multilínea)
        if top_spans:
            max_size = top_spans[0]["size"]
            title_parts = [
                s["text"] for s in top_spans
                if abs(s["size"] - max_size) < 2 and len(s["text"]) > 3
            ]
            title = " ".join(title_parts)
            if len(title) > 10:
                return title[:300]

        # Último fallback
        raw = page.get_text("text").strip()
        lines = [l.strip() for l in raw.splitlines() if len(l.strip()) > 20]
        return lines[0][:200] if lines else ""

    except Exception as e:
        logger.debug(f"_extract_title_from_pdf error for {pdf_path}: {e}")
        return ""


# ── Fuzzy matching ────────────────────────────────────────────────────────────

def _fuzzy_score(a: str, b: str) -> float:
    """
    Calcula score de similitud entre dos títulos usando rapidfuzz si está disponible,
    con fallback a difflib para no depender de la instalación.
    Score rango: 0–100.
    """
    a = a.lower().strip()
    b = b.lower().strip()
    if not a or not b:
        return 0.0

    try:
        from rapidfuzz import fuzz
        return max(
            fuzz.token_set_ratio(a, b),
            fuzz.partial_ratio(a, b),
        )
    except ImportError:
        from difflib import SequenceMatcher
        ratio = SequenceMatcher(None, a, b).ratio() * 100
        return ratio


def _normalize_title(t: str) -> str:
    """Normaliza título para comparación: minúsculas, sin puntuación extra."""
    import re
    t = t.lower().strip()
    t = re.sub(r"[^\w\s]", " ", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


# ── Escaneo de Downloads ──────────────────────────────────────────────────────

def scan_downloads(
    since_ts: float,           # timestamp Unix del momento en que se inició la sesión asistida
    reference_ids: list[int],  # IDs de referencias candidatas (sin PDF)
    db,                        # SQLAlchemy Session
    min_score: float = 55.0,   # score mínimo para considerar un match
) -> dict:
    """
    Escanea la carpeta Downloads buscando PDFs más nuevos que since_ts.
    Para cada PDF encontrado:
      1. Extrae el título de la primera página
      2. Hace fuzzy matching contra las referencias candidatas

    Returns:
        {
            "downloads_folder": str,
            "pdfs_found": int,
            "matches": [
                {
                    "pdf_path":    str,   # ruta absoluta al PDF descargado
                    "pdf_name":    str,   # nombre del archivo
                    "pdf_title":   str,   # título extraído del PDF
                    "reference_id": int,
                    "ref_title":   str,
                    "ref_doi":     str | None,
                    "ref_authors": str | None,
                    "ref_year":    int | None,
                    "score":       float, # 0–100
                }
            ],
            "unmatched_pdfs":   [str],   # PDFs sin match suficiente
            "unmatched_refs":   [int],   # ref_ids sin PDF encontrado
        }
    """
    from models.reference import Reference

    dl_folder = _find_downloads_folder()
    logger.info(f"scan_downloads: carpeta={dl_folder}, desde={datetime.fromtimestamp(since_ts)}")

    # Obtener referencias candidatas
    refs = (
        db.query(Reference)
        .filter(Reference.id.in_(reference_ids))
        .all()
    ) if reference_ids else []

    # Escanear PDFs nuevos en Downloads
    new_pdfs: list[Path] = []
    try:
        for f in dl_folder.iterdir():
            if f.suffix.lower() == ".pdf" and f.stat().st_mtime >= since_ts:
                new_pdfs.append(f)
    except Exception as e:
        logger.error(f"scan_downloads: error leyendo {dl_folder}: {e}")

    new_pdfs.sort(key=lambda f: f.stat().st_mtime)
    logger.info(f"scan_downloads: {len(new_pdfs)} PDFs nuevos encontrados")

    if not new_pdfs or not refs:
        return {
            "downloads_folder": str(dl_folder),
            "pdfs_found":        len(new_pdfs),
            "matches":           [],
            "unmatched_pdfs":    [str(p) for p in new_pdfs],
            "unmatched_refs":    [r.id for r in refs],
        }

    # Extraer títulos de PDFs
    pdf_titles: dict[Path, str] = {}
    for pdf_path in new_pdfs:
        title = _extract_title_from_pdf(pdf_path)
        pdf_titles[pdf_path] = title
        logger.info(f"  PDF: {pdf_path.name!r} → título extraído: {title[:80]!r}")

    # Construir matriz de scores y elegir mejor match por PDF y por ref
    # Usamos asignación greedy (mejor score primero)
    score_matrix: list[tuple[float, Path, object]] = []  # (score, pdf_path, ref)
    for pdf_path, pdf_title in pdf_titles.items():
        for ref in refs:
            score = _fuzzy_score(pdf_title, ref.title or "")
            # También comparar con el nombre del archivo (puede contener palabras del título)
            score_fname = _fuzzy_score(
                pdf_path.stem.replace("_", " ").replace("-", " "),
                ref.title or ""
            )
            best = max(score, score_fname)
            score_matrix.append((best, pdf_path, ref))

    score_matrix.sort(key=lambda x: -x[0])  # mayor score primero

    assigned_pdfs:  set[Path] = set()
    assigned_refs:  set[int]  = set()
    matches:        list[dict] = []

    for score, pdf_path, ref in score_matrix:
        if pdf_path in assigned_pdfs or ref.id in assigned_refs:
            continue
        if score < min_score:
            continue
        matches.append({
            "pdf_path":     str(pdf_path),
            "pdf_name":     pdf_path.name,
            "pdf_title":    pdf_titles.get(pdf_path, ""),
            "reference_id": ref.id,
            "ref_title":    ref.title or "",
            "ref_doi":      ref.doi,
            "ref_authors":  ref.authors,
            "ref_year":     ref.year,
            "score":        round(score, 1),
        })
        assigned_pdfs.add(pdf_path)
        assigned_refs.add(ref.id)

    # PDFs sin match claro (mostrar de todas formas para asignación manual)
    unmatched_pdfs = [str(p) for p in new_pdfs if p not in assigned_pdfs]

    # Para PDFs sin match automático, intentar match con umbral más bajo (para sugerir)
    low_score_suggestions: list[dict] = []
    for pdf_path in new_pdfs:
        if pdf_path in assigned_pdfs:
            continue
        best_score = 0.0
        best_ref   = None
        for ref in refs:
            if ref.id in assigned_refs:
                continue
            score = _fuzzy_score(pdf_titles.get(pdf_path, ""), ref.title or "")
            if score > best_score:
                best_score = score
                best_ref   = ref
        if best_ref and best_score >= 30:
            low_score_suggestions.append({
                "pdf_path":     str(pdf_path),
                "pdf_name":     pdf_path.name,
                "pdf_title":    pdf_titles.get(pdf_path, ""),
                "reference_id": best_ref.id,
                "ref_title":    best_ref.title or "",
                "ref_doi":      best_ref.doi,
                "ref_authors":  best_ref.authors,
                "ref_year":     best_ref.year,
                "score":        round(best_score, 1),
                "low_confidence": True,
            })

    return {
        "downloads_folder": str(dl_folder),
        "pdfs_found":        len(new_pdfs),
        "matches":           matches,
        "low_confidence":    low_score_suggestions,
        "unmatched_pdfs":    unmatched_pdfs,
        "unmatched_refs":    [r.id for r in refs if r.id not in assigned_refs],
    }


# ── Confirmar asignaciones ────────────────────────────────────────────────────

def confirm_matches(
    confirmations: list[dict],  # [{pdf_path, reference_id}]
    db,
) -> dict:
    """
    Para cada confirmación:
      1. Copia el PDF a data/PDFs con el nombre normalizado
      2. Actualiza reference.pdf_file en BD
      3. Extrae el texto y lo guarda en paper_texts

    Args:
        confirmations: lista de {pdf_path: str, reference_id: int}
        db: SQLAlchemy Session

    Returns:
        {ok: int, errors: [str]}
    """
    from models.reference import Reference
    from services.pdf_handler import _save_paper_text

    # Carpeta permitida para copiar PDFs (restricción path traversal)
    allowed_root = _find_downloads_folder().resolve()

    ok_count = 0
    errors: list[str] = []

    for item in confirmations:
        ref_id   = item.get("reference_id")
        src_path = Path(item.get("pdf_path", ""))

        try:
            # Verificar que la ruta esté dentro de la carpeta Downloads
            try:
                resolved = src_path.resolve()
                resolved.relative_to(allowed_root)
            except ValueError:
                errors.append(f"Ruta no permitida (fuera de Downloads): {src_path.name}")
                continue

            ref = db.query(Reference).filter(Reference.id == ref_id).first()
            if not ref:
                errors.append(f"Referencia {ref_id} no encontrada")
                continue
            if not src_path.exists():
                errors.append(f"PDF no encontrado: {src_path.name}")
                continue

            # Nombre destino normalizado
            safe = "".join(
                c if c.isalnum() or c in " -_" else "_"
                for c in (ref.title or f"ref_{ref_id}")[:50]
            )
            filename = f"{ref_id}_{safe.strip().replace(' ', '_').lower()}.pdf"
            dest     = PDF_DIR / filename

            # Copiar archivo
            shutil.copy2(str(src_path), str(dest))

            # Actualizar BD
            ref.pdf_file = filename
            db.commit()

            # Extraer texto
            try:
                from services.pdf_text_extractor import extract_text, extract_to_markdown
                plain   = extract_text(str(dest))
                md_text = extract_to_markdown(str(dest))
                _save_paper_text(ref_id, plain, md_text, db)
            except Exception as e:
                logger.warning(f"confirm_matches: texto no extraído para ref {ref_id}: {e}")

            ok_count += 1
            logger.info(f"confirm_matches: ref {ref_id} → {filename}")

        except Exception as e:
            logger.error(f"confirm_matches error ref {ref_id}: {e}")
            errors.append(f"Error en ref {ref_id}: {str(e)}")

    return {"ok": ok_count, "errors": errors}
