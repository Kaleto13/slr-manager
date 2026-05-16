"""
Router: Gestión de PDFs
POST   /pdfs/{reference_id}/upload   → subir PDF manualmente
DELETE /pdfs/{reference_id}          → eliminar PDF
GET    /pdfs/{reference_id}/download → descargar PDF al navegador
POST   /pdfs/{reference_id}/fetch    → descargar PDF desde URL o DOI (OA)
POST   /pdfs/{reference_id}/fetch-smart → descarga inteligente (6 estrategias)
POST   /pdfs/{reference_id}/extract  → (re)extraer texto de PDF ya guardado
GET    /pdfs/{reference_id}/text     → obtener texto extraído (paper_texts)
POST   /pdfs/assisted/scan           → escanear Downloads para importación asistida
POST   /pdfs/assisted/confirm        → confirmar matches de importación asistida
GET    /pdfs/assisted/downloads-folder → retorna la carpeta Downloads detectada
"""

import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel, field_validator

from database import get_db
from models.paper_text import PaperText
from services.pdf_handler import (
    upload_pdf, delete_pdf, get_pdf_path,
    download_and_extract, download_open_access, extract_text_from_existing,
    download_smart_pdf,
)

router = APIRouter(prefix="/pdfs", tags=["pdfs"])


# ── Schemas ────────────────────────────────────────────────────

class PDFUploadResponse(BaseModel):
    filename: str
    size_mb: float
    reference_id: int


# ── Endpoints ──────────────────────────────────────────────────

@router.post("/{reference_id}/upload")
async def upload_pdf_endpoint(
    reference_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Sube un PDF para una referencia."""
    try:
        result = upload_pdf(file, reference_id, db)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al guardar PDF: {str(e)}")


@router.delete("/{reference_id}")
async def delete_pdf_endpoint(
    reference_id: int,
    db: Session = Depends(get_db),
):
    """Elimina un PDF."""
    deleted = delete_pdf(reference_id, db)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"No hay PDF para la referencia {reference_id}")
    return {"deleted": True, "reference_id": reference_id}


@router.get("/{reference_id}/download")
async def download_pdf_endpoint(
    reference_id: int,
    inline: bool = Query(False, description="True → abre en el navegador; False → descarga"),
    db: Session = Depends(get_db),
):
    """
    Sirve un PDF.
    - ?inline=false (default) → Content-Disposition: attachment  (descarga)
    - ?inline=true            → Content-Disposition: inline      (abre en pestaña/visor)
    """
    filepath = get_pdf_path(reference_id, db)
    if not filepath:
        raise HTTPException(status_code=404, detail=f"PDF no encontrado para referencia {reference_id}")

    filename = filepath.split("/")[-1]
    disposition = "inline" if inline else f'attachment; filename="{filename}"'

    with open(filepath, "rb") as f:
        content = f.read()

    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": disposition},
    )


# ── Nuevos endpoints PASO 9 ────────────────────────────────────────────────────

# Rangos de red privada que el servidor no debe contactar por SSRF
_PRIVATE_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),   # link-local / cloud metadata
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]


def _validate_url_ssrf(url: str) -> str:
    """
    Valida que la URL sea http/https y no apunte a redes privadas o locales.
    Lanza ValueError si la URL es insegura.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Solo se permiten URLs http/https")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL sin hostname")
    # Resolver el hostname a IP y verificar que no sea privada
    try:
        ip_str = socket.getaddrinfo(hostname, None)[0][4][0]
        ip = ipaddress.ip_address(ip_str)
    except Exception:
        raise ValueError(f"No se pudo resolver el hostname: {hostname}")
    for net in _PRIVATE_NETWORKS:
        if ip in net:
            raise ValueError(f"URL apunta a una red privada/local: {ip}")
    return url


class FetchRequest(BaseModel):
    url: Optional[str] = None    # URL directa al PDF
    use_oa: bool = False          # True → intentar Unpaywall con el DOI de la referencia

    @field_validator("url")
    @classmethod
    def url_must_be_public(cls, v):
        if v is not None:
            _validate_url_ssrf(v)
        return v


@router.post("/{reference_id}/fetch")
def fetch_pdf_endpoint(
    reference_id: int,
    body: FetchRequest,
    db: Session = Depends(get_db),
):
    """
    Descarga un PDF desde una URL externa o desde Open Access (Unpaywall).
    Extrae el texto y lo guarda en paper_texts.

    Body:
        url     : URL directa al PDF (opcional si use_oa=True)
        use_oa  : True → intentar descargar el PDF OA usando el DOI de la referencia
    """
    if body.use_oa:
        result = download_open_access(reference_id, db)
    elif body.url:
        result = download_and_extract(reference_id, body.url, db)
    else:
        raise HTTPException(status_code=400, detail="Debes indicar 'url' o 'use_oa: true'")

    if not result.get("ok"):
        status_code = 404 if result.get("status") in ("not_found", "no_doi", "no_oa") else 502
        raise HTTPException(status_code=status_code, detail=result.get("message", "Error desconocido"))

    return result


@router.post("/{reference_id}/fetch-smart")
def fetch_smart_endpoint(
    reference_id: int,
    db: Session = Depends(get_db),
):
    """
    Descarga inteligente de PDF con 6 estrategias en cascada:
      1. Unpaywall (OA verificado)
      2. Semantic Scholar API
      3. CrossRef full-text links
      4. Europe PMC (literatura biomédica)
      5. Patrones por publisher (Springer, Wiley, T&F, SAGE, etc.)
      6. Resolución DOI + scraping de landing page

    Estrategias 5 y 6 aprovechan el acceso institucional universitario.
    Si descarga con éxito, extrae el texto y lo guarda en paper_texts.
    """
    result = download_smart_pdf(reference_id, db)
    if not result.get("ok"):
        status_code = 404 if result.get("strategy") in ("not_found", "no_doi") else 422
        raise HTTPException(status_code=status_code, detail=result.get("message", "No se pudo descargar"))
    return result


@router.post("/{reference_id}/extract")
def extract_text_endpoint(
    reference_id: int,
    db: Session = Depends(get_db),
):
    """
    (Re)extrae el texto de un PDF ya guardado en disco.
    Útil para PDFs subidos manualmente que aún no tienen texto en paper_texts.
    """
    result = extract_text_from_existing(reference_id, db)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("message", "Error al extraer texto"))
    return result


# ── Importación asistida ──────────────────────────────────────────────────────

class AssistedScanRequest(BaseModel):
    since_ts:      float       # timestamp Unix de inicio de sesión asistida
    reference_ids: list[int]   # IDs de referencias candidatas (sin PDF)
    min_score:     float = 55.0


class AssistedConfirmRequest(BaseModel):
    confirmations: list[dict]  # [{pdf_path: str, reference_id: int}]


@router.get("/assisted/downloads-folder")
def get_downloads_folder():
    """Retorna la carpeta de Descargas detectada (para mostrar al usuario)."""
    from services.assisted_import import _find_downloads_folder
    folder = _find_downloads_folder()
    return {"path": str(folder), "exists": folder.exists()}


@router.post("/assisted/scan")
def assisted_scan(
    body: AssistedScanRequest,
    db: Session = Depends(get_db),
):
    """
    Escanea la carpeta Downloads buscando PDFs descargados desde since_ts.
    Hace fuzzy matching contra las referencias indicadas.
    Retorna matches con score de confianza para confirmación del usuario.
    """
    from services.assisted_import import scan_downloads
    result = scan_downloads(
        since_ts=body.since_ts,
        reference_ids=body.reference_ids,
        db=db,
        min_score=body.min_score,
    )
    return result


@router.post("/assisted/confirm")
def assisted_confirm(
    body: AssistedConfirmRequest,
    db: Session = Depends(get_db),
):
    """
    Confirma los matches seleccionados por el usuario:
    copia los PDFs a data/PDFs, actualiza BD y extrae texto.
    """
    from services.assisted_import import confirm_matches
    if not body.confirmations:
        raise HTTPException(status_code=400, detail="No hay confirmaciones en el cuerpo")
    result = confirm_matches(body.confirmations, db)
    return result


@router.get("/{reference_id}/text")
def get_text_endpoint(
    reference_id: int,
    format: str = Query("plain", description="'plain' o 'markdown'"),
    db: Session = Depends(get_db),
):
    """
    Devuelve el texto extraído de un PDF (plain o markdown).
    """
    record = db.query(PaperText).filter(PaperText.reference_id == reference_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="No hay texto extraído para esta referencia")

    text = record.markdown_text if format == "markdown" else record.plain_text
    return {
        "reference_id": reference_id,
        "format":       format,
        "char_count":   record.char_count,
        "text":         text or "",
        "updated_at":   record.updated_at,
    }
