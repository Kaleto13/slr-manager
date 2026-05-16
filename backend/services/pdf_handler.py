"""
Servicio para manejar PDFs asociados a referencias.
Guardar, eliminar, obtener y descargar+extraer archivos PDF.
"""

import os
import shutil
from pathlib import Path
from sqlalchemy.orm import Session
from models.reference import Reference
from models.paper_text import PaperText

PDF_DIR = Path("data/PDFs")
PDF_DIR.mkdir(parents=True, exist_ok=True)
MAX_PDF_SIZE = 50 * 1024 * 1024  # 50 MB


def normalize_filename(title: str) -> str:
    """Normaliza título para usar como nombre de archivo."""
    if not title:
        return "document"
    # Reemplazar caracteres especiales
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in title[:50])
    return safe.strip().replace(" ", "_").lower()


def upload_pdf(file, reference_id: int, db: Session) -> dict:
    """
    Guarda un PDF en /data/PDFs/{reference_id}_{titulo}.pdf
    Actualiza references.pdf_file en BD.

    Args:
        file: UploadFile de FastAPI
        reference_id: ID de la referencia
        db: Sesión SQLAlchemy

    Returns:
        {"filename": "...", "size_mb": 1.5, "reference_id": 1}

    Raises:
        FileNotFoundError: si la referencia no existe
        ValueError: si el archivo es demasiado grande
    """
    # Verificar referencia
    ref = db.query(Reference).filter(Reference.id == reference_id).first()
    if not ref:
        raise FileNotFoundError(f"Referencia {reference_id} no encontrada")

    # Verificar tamaño
    file.file.seek(0, 2)  # Ir al final
    size_bytes = file.file.tell()
    file.file.seek(0)  # Volver al inicio

    if size_bytes > MAX_PDF_SIZE:
        raise ValueError(f"Archivo demasiado grande ({size_bytes / 1024 / 1024:.1f} MB > 50 MB)")

    # Generar nombre seguro
    safe_title = normalize_filename(ref.title or f"ref_{reference_id}")
    filename = f"{reference_id}_{safe_title}.pdf"
    filepath = PDF_DIR / filename

    # Guardar archivo
    with open(filepath, "wb") as f:
        content = file.file.read()
        f.write(content)

    # Actualizar BD
    ref.pdf_file = filename
    db.commit()

    size_mb = size_bytes / 1024 / 1024
    return {
        "filename": filename,
        "size_mb": round(size_mb, 2),
        "reference_id": reference_id,
    }


def delete_pdf(reference_id: int, db: Session) -> bool:
    """
    Elimina PDF de disco y limpia referencia.pdf_file en BD.

    Args:
        reference_id: ID de la referencia
        db: Sesión SQLAlchemy

    Returns:
        True si se eliminó, False si no existía PDF
    """
    ref = db.query(Reference).filter(Reference.id == reference_id).first()
    if not ref or not ref.pdf_file:
        return False

    filepath = PDF_DIR / ref.pdf_file
    if filepath.exists():
        filepath.unlink()

    ref.pdf_file = None
    db.commit()
    return True


def get_pdf_path(reference_id: int, db: Session) -> str or None:
    """
    Obtiene ruta completa al PDF si existe.

    Args:
        reference_id: ID de la referencia
        db: Sesión SQLAlchemy

    Returns:
        Ruta al archivo o None
    """
    ref = db.query(Reference).filter(Reference.id == reference_id).first()
    if not ref or not ref.pdf_file:
        return None

    filepath = PDF_DIR / ref.pdf_file
    if filepath.exists():
        return str(filepath)
    return None


# ── Descarga desde URL + extracción de texto ──────────────────────────────────

def _save_paper_text(reference_id: int, plain: str, markdown: str, db: Session) -> PaperText:
    """Inserta o actualiza el texto extraído en paper_texts."""
    existing = db.query(PaperText).filter(PaperText.reference_id == reference_id).first()
    if existing:
        existing.plain_text    = plain
        existing.markdown_text = markdown
        existing.char_count    = len(plain)
    else:
        existing = PaperText(
            reference_id   = reference_id,
            plain_text     = plain,
            markdown_text  = markdown,
            char_count     = len(plain),
        )
        db.add(existing)
    db.commit()
    db.refresh(existing)
    return existing


def download_and_extract(
    reference_id: int,
    url: str,
    db: Session,
) -> dict:
    """
    Descarga un PDF desde una URL, lo guarda en disco, extrae el texto
    y lo persiste en paper_texts.

    Returns:
        {
          "ok":       bool,
          "filename": str | None,
          "status":   "downloaded" | "already_exists" | "download_failed" | "extract_failed",
          "char_count": int,
          "is_scanned": bool,
          "message":  str,
        }
    """
    from services.oa_downloader import download_pdf_from_url as _dl
    from services.pdf_text_extractor import extract_text, extract_to_markdown, extract_summary_info

    ref = db.query(Reference).filter(Reference.id == reference_id).first()
    if not ref:
        return {"ok": False, "status": "not_found", "message": "Referencia no encontrada"}

    # Nombre de archivo
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in (ref.title or f"ref_{reference_id}")[:50])
    filename = f"{reference_id}_{safe.strip().replace(' ', '_').lower()}.pdf"
    filepath = PDF_DIR / filename

    # Si ya existe el archivo en disco, sólo extraer si no hay texto
    already = filepath.exists() and ref.pdf_file == filename
    if not already:
        success = _dl(url, filepath)
        if not success:
            # Diagnóstico según tipo de URL
            from urllib.parse import urlparse
            host = urlparse(url).hostname or ""
            if any(d in host for d in ("sciencedirect", "elsevier", "springer", "wiley", "tandfonline")):
                hint = (
                    "La URL pertenece a un repositorio de acceso restringido. "
                    "Si la URL es un enlace firmado (S3/token), verifica que no haya expirado (suelen durar 5 min). "
                    "Para artículos de pago, descarga el PDF manualmente desde tu institución y súbelo con el botón 'Agregar PDF'."
                )
            elif "amazonaws.com" in host:
                hint = "La URL firmada de S3 puede haber expirado (validez típica: 5 minutos). Genera una nueva URL desde la fuente original."
            else:
                hint = f"No se pudo descargar el PDF desde: {url}"
            return {
                "ok": False, "filename": None,
                "status": "download_failed",
                "message": hint,
                "char_count": 0, "is_scanned": False,
            }
        # Actualizar BD con nombre de archivo
        ref.pdf_file = filename
        db.commit()

    # Extraer texto
    try:
        info    = extract_summary_info(str(filepath))
        plain   = extract_text(str(filepath))
        md_text = extract_to_markdown(str(filepath))
        _save_paper_text(reference_id, plain, md_text, db)
    except Exception as e:
        return {
            "ok": False, "filename": filename,
            "status": "extract_failed",
            "message": f"PDF guardado pero no se pudo extraer texto: {e}",
            "char_count": 0, "is_scanned": False,
        }

    return {
        "ok":         True,
        "filename":   filename,
        "status":     "already_exists" if already else "downloaded",
        "char_count": info.get("char_count", len(plain)),
        "is_scanned": info.get("is_scanned", False),
        "message":    "OK",
    }


def download_open_access(reference_id: int, db: Session) -> dict:
    """
    Intenta descargar el PDF usando el DOI via Unpaywall.
    Si hay URL directa disponible, llama a download_and_extract.

    Returns:
        Mismo dict que download_and_extract, o {"ok": False, "status": "no_oa"} si no hay OA.
    """
    from services.oa_downloader import check_oa

    ref = db.query(Reference).filter(Reference.id == reference_id).first()
    if not ref:
        return {"ok": False, "status": "not_found", "message": "Referencia no encontrada"}

    doi = (ref.doi or "").strip()
    if not doi:
        return {"ok": False, "status": "no_doi", "message": "La referencia no tiene DOI"}

    oa = check_oa(doi)
    if not oa.get("is_oa") or not oa.get("pdf_url"):
        return {
            "ok": False, "status": "no_oa",
            "message": f"No disponible en OA (estado: {oa.get('oa_status', 'unknown')})",
        }

    return download_and_extract(reference_id, oa["pdf_url"], db)


def download_smart_pdf(reference_id: int, db: Session) -> dict:
    """
    Descarga inteligente: prueba 6 estrategias en cascada
    (Unpaywall → Semantic Scholar → CrossRef → Europe PMC →
     Publisher patterns → DOI resolve/scraping).
    Si tiene éxito, extrae el texto y lo guarda en paper_texts.

    Returns:
        {
          "ok":         bool,
          "strategy":   str,
          "filename":   str | None,
          "char_count": int,
          "is_scanned": bool,
          "message":    str,
        }
    """
    from services.oa_downloader import download_smart
    from services.pdf_text_extractor import extract_text, extract_to_markdown, extract_summary_info

    ref = db.query(Reference).filter(Reference.id == reference_id).first()
    if not ref:
        return {"ok": False, "strategy": "not_found", "filename": None,
                "char_count": 0, "is_scanned": False, "message": "Referencia no encontrada"}

    doi = (ref.doi or "").strip()

    # Intentar descarga con cadena de estrategias
    result = download_smart(doi, ref.title or "", reference_id, db)

    if not result["ok"]:
        return {
            "ok": False,
            "strategy": result["strategy"],
            "filename": None,
            "char_count": 0,
            "is_scanned": False,
            "message": result["message"],
        }

    # PDF descargado — extraer texto
    filepath_str = result["filepath"]
    filename     = result["filename"]
    try:
        info    = extract_summary_info(filepath_str)
        plain   = extract_text(filepath_str)
        md_text = extract_to_markdown(filepath_str)
        _save_paper_text(reference_id, plain, md_text, db)
        char_count = info.get("char_count", len(plain))
        is_scanned = info.get("is_scanned", False)
    except Exception as e:
        return {
            "ok": False,
            "strategy": result["strategy"],
            "filename": filename,
            "char_count": 0,
            "is_scanned": False,
            "message": f"PDF guardado pero no se pudo extraer texto: {e}",
        }

    return {
        "ok":         True,
        "strategy":   result["strategy"],
        "filename":   filename,
        "char_count": char_count,
        "is_scanned": is_scanned,
        "message":    result["message"],
    }


def extract_text_from_existing(reference_id: int, db: Session) -> dict:
    """
    Re-extrae el texto de un PDF ya guardado en disco.
    Útil si se subió manualmente y aún no hay texto en paper_texts.
    """
    from services.pdf_text_extractor import extract_text, extract_to_markdown, extract_summary_info

    pdf_path = get_pdf_path(reference_id, db)
    if not pdf_path:
        return {"ok": False, "status": "no_pdf", "message": "No hay PDF para esta referencia"}

    try:
        info    = extract_summary_info(pdf_path)
        plain   = extract_text(pdf_path)
        md_text = extract_to_markdown(pdf_path)
        _save_paper_text(reference_id, plain, md_text, db)
        return {
            "ok":         True,
            "status":     "extracted",
            "char_count": info.get("char_count", len(plain)),
            "is_scanned": info.get("is_scanned", False),
            "message":    "Texto extraído correctamente",
        }
    except Exception as e:
        return {"ok": False, "status": "extract_failed", "message": str(e)}
