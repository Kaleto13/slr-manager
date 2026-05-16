"""
Servicio de descarga de PDFs.

Estrategias (en orden de prioridad):
  1. Unpaywall  — OA verificado con DOI
  2. Semantic Scholar — API gratuita con links OA
  3. CrossRef   — metadata de full-text links
  4. Patrones por publisher — URLs directas según prefijo DOI
  5. Resolución DOI + scraping HTML — para red universitaria
"""

import time
import logging
import requests
from pathlib import Path
from urllib.parse import urlparse, quote
from sqlalchemy.orm import Session
from models.reference import Reference
from models.search_reference import SearchReference
from config import OA_EMAIL

logger = logging.getLogger(__name__)

OA_EMAIL = OA_EMAIL or "slr-manager@example.com"  # fallback seguro si no se configura
PDF_DIR = Path("data/PDFs")
PDF_DIR.mkdir(parents=True, exist_ok=True)

# User-Agent de navegador realista (necesario para repositorios académicos y S3 firmados)
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

HEADERS = {
    "User-Agent":      _BROWSER_UA,
    "Accept":          "application/pdf,application/octet-stream,text/html,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection":      "keep-alive",
    "DNT":             "1",
}

# Referers explícitos para publishers que los exigen (acceso restringido)
_REFERER_MAP = {
    "sciencedirect.com":       "https://www.sciencedirect.com/",
    "elsevier.com":            "https://www.sciencedirect.com/",
    "amazonaws.com":           "https://www.sciencedirect.com/",   # S3 firmado de Elsevier
    "springer.com":            "https://link.springer.com/",
    "springerlink.com":        "https://link.springer.com/",
    "nature.com":              "https://www.nature.com/",
    "wiley.com":               "https://onlinelibrary.wiley.com/",
    "onlinelibrary.wiley.com": "https://onlinelibrary.wiley.com/",
    "tandfonline.com":         "https://www.tandfonline.com/",
    "researchgate.net":        "https://www.researchgate.net/",
    "academia.edu":            "https://www.academia.edu/",
    "arxiv.org":               "https://arxiv.org/",
    "ncbi.nlm.nih.gov":        "https://pubmed.ncbi.nlm.nih.gov/",
    "pmc.ncbi.nlm.nih.gov":    "https://pmc.ncbi.nlm.nih.gov/",
    "plos.org":                "https://journals.plos.org/",
    "mdpi.com":                "https://www.mdpi.com/",
    "frontiersin.org":         "https://www.frontiersin.org/",
    "hindawi.com":             "https://www.hindawi.com/",
    "iopscience.iop.org":      "https://iopscience.iop.org/",
    "cambridge.org":           "https://www.cambridge.org/",
    "oxfordjournals.org":      "https://academic.oup.com/",
    "academic.oup.com":        "https://academic.oup.com/",
    "sagepub.com":             "https://journals.sagepub.com/",
    "ieee.org":                "https://ieeexplore.ieee.org/",
    "ieeexplore.ieee.org":     "https://ieeexplore.ieee.org/",
    "acm.org":                 "https://dl.acm.org/",
    "biorxiv.org":             "https://www.biorxiv.org/",
    "medrxiv.org":             "https://www.medrxiv.org/",
    "ssrn.com":                "https://ssrn.com/",
    "zenodo.org":              "https://zenodo.org/",
    "figshare.com":            "https://figshare.com/",
    "hal.science":             "https://hal.science/",
    "core.ac.uk":              "https://core.ac.uk/",
    "semanticscholar.org":     "https://www.semanticscholar.org/",
}

# Content-types que definitivamente NO son PDF (sin HTML — lo manejamos aparte)
NON_PDF_TYPES = {"text/xml", "application/xml", "application/json"}


def _headers_for_url(url: str) -> dict:
    """
    Construye headers con Referer apropiado según el dominio de la URL.
    Para dominios no mapeados usa el propio origen de la URL como Referer
    (la mayoría de publishers OA lo aceptan).
    """
    headers = dict(HEADERS)
    headers["Upgrade-Insecure-Requests"] = "1"
    try:
        parsed = urlparse(url)
        host   = parsed.hostname or ""
        origin = f"{parsed.scheme}://{host}"

        # Buscar en mapa explícito
        referer = None
        for domain, mapped_referer in _REFERER_MAP.items():
            if domain in host:
                referer = mapped_referer
                break

        # Fallback: usar el propio origen como Referer (funciona para la mayoría de OA)
        if not referer:
            referer = origin + "/"

        headers["Referer"]        = referer
        headers["Origin"]         = origin
        headers["Sec-Fetch-Dest"] = "document"
        headers["Sec-Fetch-Mode"] = "navigate"
        headers["Sec-Fetch-Site"] = "same-origin" if referer.startswith(origin) else "cross-site"

    except Exception:
        pass
    return headers


# ── API Unpaywall ──────────────────────────────────────────────

def _find_pdf_url(data: dict) -> str | None:
    """
    Busca la mejor URL directa a PDF en los datos de Unpaywall.
    Estrategia: primero busca url_for_pdf en TODOS los oa_locations
    (no solo best_oa_location), ordenando por: gold > hybrid > green > bronze.
    """
    locations = data.get("oa_locations") or []

    # Prioridad: url_for_pdf directo
    priority_order = ["gold", "hybrid", "green", "bronze", None]
    for oa_type in priority_order:
        for loc in locations:
            if oa_type is None or loc.get("host_type") == oa_type or loc.get("license") == oa_type:
                url = loc.get("url_for_pdf")
                if url:
                    return url

    # Segunda pasada: cualquier url_for_pdf
    for loc in locations:
        url = loc.get("url_for_pdf")
        if url:
            return url

    # Fallback: url del best_oa_location (podría ser landing page)
    best = data.get("best_oa_location")
    if best:
        return best.get("url_for_pdf") or best.get("url")

    return None


def check_oa(doi: str) -> dict:
    """
    Consulta Unpaywall para verificar si un DOI tiene versión Open Access.

    Returns:
        {
            "is_oa": bool,
            "pdf_url": str | None,      # URL directa al PDF si existe
            "has_direct_pdf": bool,      # True si pdf_url es url_for_pdf (no landing)
            "oa_status": str,            # gold, green, hybrid, bronze, closed
        }
    """
    try:
        url = f"https://api.unpaywall.org/v2/{doi}?email={OA_EMAIL}"
        r = requests.get(url, timeout=15, headers={"User-Agent": _BROWSER_UA})

        if r.status_code == 200:
            data = r.json()
            is_oa = data.get("is_oa", False)
            pdf_url = None
            has_direct_pdf = False

            if is_oa:
                # Buscar url_for_pdf directo en todos los locations
                locations = data.get("oa_locations") or []
                for loc in locations:
                    u = loc.get("url_for_pdf")
                    if u:
                        pdf_url = u
                        has_direct_pdf = True
                        break

                # Si no hay url_for_pdf directo, usar URL del best_oa_location
                if not pdf_url:
                    best = data.get("best_oa_location")
                    if best:
                        pdf_url = best.get("url_for_pdf") or best.get("url")
                        has_direct_pdf = bool(best.get("url_for_pdf"))

            return {
                "is_oa": is_oa,
                "pdf_url": pdf_url,
                "has_direct_pdf": has_direct_pdf,
                "oa_status": data.get("oa_status", "unknown"),
            }

        if r.status_code == 404:
            return {"is_oa": False, "pdf_url": None, "has_direct_pdf": False, "oa_status": "not_found"}
        if r.status_code == 429:
            logger.warning("Unpaywall rate limit hit, waiting 2s")
            time.sleep(2)
            return {"is_oa": False, "pdf_url": None, "has_direct_pdf": False, "oa_status": "rate_limited"}

    except requests.exceptions.Timeout:
        return {"is_oa": False, "pdf_url": None, "has_direct_pdf": False, "oa_status": "timeout"}
    except Exception as e:
        logger.error(f"check_oa error for DOI {doi}: {e}")
        return {"is_oa": False, "pdf_url": None, "has_direct_pdf": False, "oa_status": "error"}

    return {"is_oa": False, "pdf_url": None, "has_direct_pdf": False, "oa_status": "unknown"}


def _extract_pdf_url_from_html(html_bytes: bytes, base_url: str) -> str | None:
    """
    Busca URL directa al PDF dentro de una página HTML de repositorio.

    Estrategia (en orden de prioridad):
    1. <meta name="citation_pdf_url">  — DSpace, ePrints, OJS, MDPI, Frontiers
    2. <meta property="og:url"> o <link rel="canonical"> si apunta a PDF
    3. <a href> que termina en .pdf o contiene /pdf/, /bitstream/, /download/
    4. Atributos data-pdf-url o data-src apuntando a PDF
    """
    from html.parser import HTMLParser
    from urllib.parse import urljoin

    class _Finder(HTMLParser):
        def __init__(self):
            super().__init__()
            self.citation_pdf:   str | None  = None
            self.og_url:         str | None  = None
            self.canonical:      str | None  = None
            self.pdf_links:      list[str]   = []

        def handle_starttag(self, tag, attrs):
            attrs_dict = dict(attrs)
            tag = tag.lower()

            if tag == "meta":
                name     = attrs_dict.get("name",     "").lower()
                prop     = attrs_dict.get("property", "").lower()
                content  = attrs_dict.get("content",  "").strip()
                if name == "citation_pdf_url" and content:
                    self.citation_pdf = content
                elif prop == "og:url" and content:
                    self.og_url = content

            elif tag == "link":
                rel  = attrs_dict.get("rel",  "").lower()
                href = attrs_dict.get("href", "").strip()
                if rel == "canonical" and href:
                    self.canonical = href
                # <link rel="alternate" type="application/pdf">
                elif "alternate" in rel and attrs_dict.get("type", "") == "application/pdf" and href:
                    self.citation_pdf = href

            elif tag == "a":
                href = attrs_dict.get("href", "").strip()
                if not href:
                    return
                href_lower = href.lower()
                is_pdf_link = (
                    href_lower.endswith(".pdf")
                    or "/pdf" in href_lower
                    or "/bitstream/" in href_lower
                    or "/download/" in href_lower
                    or "type=pdf" in href_lower
                    or "format=pdf" in href_lower
                )
                if is_pdf_link:
                    self.pdf_links.append(href)

            # data-pdf-url o data-src apuntando a PDF
            for attr, val in attrs_dict.items():
                if attr in ("data-pdf-url", "data-src", "data-url") and val and ".pdf" in val.lower():
                    self.pdf_links.insert(0, val)  # alta prioridad

    try:
        html_str = html_bytes.decode("utf-8", errors="ignore")
        finder = _Finder()
        finder.feed(html_str)

        # 1. citation_pdf_url (máxima prioridad)
        if finder.citation_pdf:
            return urljoin(base_url, finder.citation_pdf)

        # 2. Links <a> o data-attr que apuntan directamente a un .pdf
        for link in finder.pdf_links:
            absolute = urljoin(base_url, link)
            if absolute.lower().endswith(".pdf"):
                return absolute

        # 3. Links /pdf/ con extensión conocida en primer candidato
        if finder.pdf_links:
            return urljoin(base_url, finder.pdf_links[0])

        # 4. og:url / canonical solo si parece ser URL de PDF
        for url_candidate in (finder.og_url, finder.canonical):
            if url_candidate and ("/pdf" in url_candidate.lower() or url_candidate.lower().endswith(".pdf")):
                return urljoin(base_url, url_candidate)

    except Exception as e:
        logger.debug(f"_extract_pdf_url_from_html error: {e}")
    return None


def download_pdf_from_url(url: str, filepath: Path, _depth: int = 0) -> bool:
    """
    Descarga un PDF desde una URL y lo guarda en filepath.
    Maneja redirects, diferentes content-types y verifica magic bytes.
    Usa headers de navegador + Referer específico por dominio para evitar 403.

    Returns:
        True si se descargó correctamente, False en cualquier error.
    """
    if _depth > 3:
        logger.debug("download_pdf: demasiadas redirecciones HTML, abortando")
        return False

    try:
        headers = _headers_for_url(url)
        session = requests.Session()
        session.headers.update(headers)

        r = session.get(
            url,
            timeout=45,
            allow_redirects=True,
            stream=True,
        )

        logger.info(f"download_pdf [{_depth}]: {r.status_code} {r.headers.get('content-type','?')} → {r.url}")

        if r.status_code == 403:
            logger.warning(f"download_pdf: HTTP 403 (acceso denegado) for {url}")
            return False
        if r.status_code == 401:
            logger.warning(f"download_pdf: HTTP 401 (autenticación requerida) for {url}")
            return False
        if r.status_code not in (200, 206):
            logger.warning(f"download_pdf: HTTP {r.status_code} for {url}")
            return False

        content_type = r.headers.get("content-type", "").lower().split(";")[0].strip()
        final_url    = r.url  # URL real tras redirects

        # Rechazar tipos que definitivamente no son PDF
        if content_type in NON_PDF_TYPES:
            logger.debug(f"download_pdf: content-type '{content_type}' rechazado para {url}")
            return False

        # ── Caso HTML: intentar extraer link al PDF ──────────────────
        if content_type == "text/html":
            html_bytes = r.content
            pdf_url = _extract_pdf_url_from_html(html_bytes, final_url)

            if pdf_url and pdf_url != url and pdf_url != final_url:
                logger.info(f"download_pdf: PDF encontrado en HTML → {pdf_url}")
                return download_pdf_from_url(pdf_url, filepath, _depth + 1)

            logger.warning(f"download_pdf: HTML sin link PDF en {url} (final={final_url})")
            return False

        # ── Caso binario: leer primeros bytes para verificar ─────────
        # Leemos siempre el primer chunk para verificar magic bytes
        chunk_iter  = r.iter_content(8192)
        first_chunk = b""
        try:
            first_chunk = next(chunk_iter)
        except StopIteration:
            logger.warning(f"download_pdf: respuesta vacía para {url}")
            return False

        # Si el contenido empieza con HTML aunque el content-type no lo diga → extraer link
        if first_chunk.lstrip()[:5].lower().startswith(b"<!doc") or first_chunk.lstrip()[:6].lower().startswith(b"<html"):
            logger.info(f"download_pdf: contenido HTML detectado por magic bytes para {url}")
            rest = first_chunk + b"".join(chunk_iter)
            pdf_url = _extract_pdf_url_from_html(rest, final_url)
            if pdf_url and pdf_url != url:
                return download_pdf_from_url(pdf_url, filepath, _depth + 1)
            return False

        # Verificar magic bytes de PDF (%PDF-)
        if not first_chunk.lstrip()[:5].startswith(b"%PDF"):
            logger.warning(f"download_pdf: no son magic bytes PDF (type={content_type}, inicio={first_chunk[:20]!r}) para {url}")
            return False

        # Guardar el archivo con límite máximo de 50 MB (previene descarga ilimitada)
        MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
        total_bytes = 0
        with open(filepath, "wb") as f:
            f.write(first_chunk)
            total_bytes += len(first_chunk)
            for chunk in chunk_iter:
                if chunk:
                    total_bytes += len(chunk)
                    if total_bytes > MAX_DOWNLOAD_BYTES:
                        logger.warning(f"download_pdf: descarga abortada, supera 50 MB en {url}")
                        filepath.unlink(missing_ok=True)
                        return False
                    f.write(chunk)

        # Verificar tamaño mínimo (10 KB — PDFs reales nunca son menores)
        size = filepath.stat().st_size if filepath.exists() else 0
        if size < 10_240:
            logger.warning(f"download_pdf: archivo sospechosamente pequeño ({size} bytes), descartando")
            filepath.unlink(missing_ok=True)
            return False

        logger.info(f"download_pdf: OK — {size/1024:.1f} KB guardado en {filepath.name}")
        return True

    except requests.exceptions.Timeout:
        logger.warning(f"download_pdf: timeout (45s) para {url}")
        filepath.unlink(missing_ok=True)
        return False
    except Exception as e:
        logger.error(f"download_pdf error: {e} — url={url}")
        filepath.unlink(missing_ok=True)
        return False


def normalize_filename(title: str, ref_id: int) -> str:
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in (title or f"ref_{ref_id}")[:50])
    return f"{ref_id}_{safe.strip().replace(' ', '_').lower()}.pdf"


# ── Estrategias adicionales de descarga ──────────────────────────────────────

def check_semantic_scholar(doi: str) -> dict:
    """
    Consulta Semantic Scholar Graph API para obtener link de PDF Open Access.

    Returns:
        {"pdf_url": str | None, "source": "semantic_scholar"}
    """
    try:
        url = f"https://api.semanticscholar.org/graph/v1/paper/DOI:{quote(doi, safe='')}?fields=openAccessPdf,externalIds"
        r = requests.get(
            url,
            timeout=15,
            headers={"User-Agent": _BROWSER_UA, "Accept": "application/json"},
        )
        if r.status_code == 200:
            data = r.json()
            oa_pdf = data.get("openAccessPdf")
            if oa_pdf and oa_pdf.get("url"):
                return {"pdf_url": oa_pdf["url"], "source": "semantic_scholar"}
        elif r.status_code == 429:
            logger.warning("Semantic Scholar rate limit hit")
    except Exception as e:
        logger.debug(f"check_semantic_scholar error for {doi}: {e}")
    return {"pdf_url": None, "source": "semantic_scholar"}


def check_crossref(doi: str) -> dict:
    """
    Consulta CrossRef API para buscar links de texto completo (full-text PDF).

    Returns:
        {"pdf_url": str | None, "source": "crossref"}
    """
    try:
        url = f"https://api.crossref.org/works/{quote(doi, safe='')}"
        r = requests.get(
            url,
            timeout=15,
            headers={
                "User-Agent": f"SLR-Manager/1.0 (mailto:{OA_EMAIL})",
                "Accept": "application/json",
            },
        )
        if r.status_code == 200:
            data = r.json()
            links = data.get("message", {}).get("link", [])
            # Buscar link con content-type application/pdf o text/html con intended-application=text-mining
            for link in links:
                ct = link.get("content-type", "")
                ia = link.get("intended-application", "")
                url_val = link.get("URL", "")
                if "pdf" in ct.lower() and url_val:
                    return {"pdf_url": url_val, "source": "crossref"}
            # Segunda pasada: text-mining o similarity-checking
            for link in links:
                ia = link.get("intended-application", "")
                url_val = link.get("URL", "")
                if ia in ("text-mining", "similarity-checking") and url_val:
                    return {"pdf_url": url_val, "source": "crossref"}
        elif r.status_code == 404:
            logger.debug(f"CrossRef 404 for DOI {doi}")
    except Exception as e:
        logger.debug(f"check_crossref error for {doi}: {e}")
    return {"pdf_url": None, "source": "crossref"}


# Mapa de prefijos DOI → función que construye URL de PDF
# Cada entry: (prefixes_tuple, url_template_fn)
_PUBLISHER_PATTERNS: list[tuple[tuple, callable]] = [
    # Springer / SpringerLink
    (("10.1007/", "10.1057/", "10.1023/", "10.1065/"),
     lambda doi: f"https://link.springer.com/content/pdf/{quote(doi, safe='')}.pdf"),
    # Nature (parte de Springer Nature)
    (("10.1038/",),
     lambda doi: f"https://www.nature.com/articles/{doi.split('/')[-1]}.pdf"),
    # Wiley Online Library
    (("10.1002/", "10.1111/", "10.1112/", "10.1113/", "10.1196/", "10.1197/", "10.1359/", "10.1592/"),
     lambda doi: f"https://onlinelibrary.wiley.com/doi/pdfdirect/{quote(doi, safe='')}?download=true"),
    # Taylor & Francis
    (("10.1080/", "10.1081/", "10.3109/", "10.3402/", "10.3816/"),
     lambda doi: f"https://www.tandfonline.com/doi/pdf/{quote(doi, safe='')}?needAccess=true"),
    # SAGE Publications
    (("10.1177/", "10.1191/", "10.1258/", "10.1243/", "10.1260/", "10.1177/"),
     lambda doi: f"https://journals.sagepub.com/doi/pdf/{quote(doi, safe='')}"),
    # Elsevier / ScienceDirect
    (("10.1016/",),
     lambda doi: f"https://www.sciencedirect.com/science/article/pii/{doi.split('/')[-1]}/pdfft?isDTMRedir=true&download=true"),
    # IEEE Xplore
    (("10.1109/",),
     lambda doi: f"https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber={doi.split('.')[-1]}"),
    # ACM Digital Library
    (("10.1145/",),
     lambda doi: f"https://dl.acm.org/doi/pdf/{quote(doi, safe='')}"),
    # Cambridge University Press
    (("10.1017/",),
     lambda doi: f"https://www.cambridge.org/core/services/aop-cambridge-core/content/view/{doi.split('/')[-1]}"),
    # Oxford University Press
    (("10.1093/",),
     lambda doi: f"https://academic.oup.com/doipdfdownload?doi={quote(doi, safe='')}"),
    # IOP Publishing
    (("10.1088/",),
     lambda doi: f"https://iopscience.iop.org/article/{quote(doi, safe='')}/pdf"),
    # American Chemical Society
    (("10.1021/",),
     lambda doi: f"https://pubs.acs.org/doi/pdf/{quote(doi, safe='')}"),
    # Royal Society of Chemistry
    (("10.1039/",),
     lambda doi: f"https://pubs.rsc.org/en/content/articlepdf/{doi.split('/')[-1]}"),
    # PLOS
    (("10.1371/",),
     lambda doi: f"https://journals.plos.org/plosone/article/file?id={quote(doi, safe='')}&type=printable"),
    # Frontiers
    (("10.3389/",),
     lambda doi: f"https://www.frontiersin.org/articles/{quote(doi, safe='')}/pdf"),
    # MDPI
    (("10.3390/",),
     lambda doi: f"https://www.mdpi.com/{'/'.join(doi.replace('10.3390/', '').split('/'))}/pdf"),
    # Hindawi
    (("10.1155/",),
     lambda doi: f"https://downloads.hindawi.com/journals/{doi.split('/')[-1]}.pdf"),
    # BioMed Central / Springer Open
    (("10.1186/",),
     lambda doi: f"https://link.springer.com/content/pdf/{quote(doi, safe='')}.pdf"),
]


def _try_publisher_patterns(doi: str, filepath: Path) -> tuple[bool, str]:
    """
    Intenta descargar el PDF usando patrones de URL específicos por publisher.
    Mapea prefijos DOI a URLs de PDF conocidas.

    Returns:
        (success: bool, strategy_name: str)
    """
    doi_lower = doi.lower()
    for prefixes, url_fn in _PUBLISHER_PATTERNS:
        for prefix in prefixes:
            if doi_lower.startswith(prefix.lower()):
                try:
                    pdf_url = url_fn(doi)
                    logger.info(f"_try_publisher_patterns: trying {pdf_url} for DOI {doi}")
                    success = download_pdf_from_url(pdf_url, filepath)
                    if success:
                        # Identificar publisher por prefijo
                        publisher = prefix.split("/")[0]
                        return True, f"publisher_pattern:{publisher}"
                except Exception as e:
                    logger.debug(f"_try_publisher_patterns error for {doi}: {e}")
                break  # Solo un match por publisher, pasar al siguiente
    return False, "publisher_pattern:none"


def _try_doi_resolve(doi: str, filepath: Path) -> tuple[bool, str]:
    """
    Resuelve el DOI siguiendo el redirect, luego intenta descargar
    el PDF desde la landing page del publisher.
    Depende de _extract_pdf_url_from_html para scraping.

    Returns:
        (success: bool, strategy_name: str)
    """
    try:
        doi_url = f"https://doi.org/{quote(doi, safe='')}"
        headers = dict(HEADERS)
        headers["Accept"] = "text/html,application/xhtml+xml,*/*"

        session = requests.Session()
        session.headers.update(headers)
        r = session.get(doi_url, timeout=30, allow_redirects=True)

        if r.status_code not in (200, 206):
            logger.debug(f"_try_doi_resolve: HTTP {r.status_code} for {doi_url}")
            return False, "doi_resolve:http_error"

        final_url = r.url
        content_type = r.headers.get("content-type", "").lower().split(";")[0].strip()

        # Si el redirect apuntó directamente a un PDF
        if content_type == "application/pdf" or r.content[:5] == b"%PDF-":
            with open(filepath, "wb") as f:
                f.write(r.content)
            size = filepath.stat().st_size
            if size >= 10_240:
                return True, "doi_resolve:direct_pdf"
            else:
                filepath.unlink(missing_ok=True)

        # Intentar extraer link de PDF desde la página HTML del publisher
        if "html" in content_type:
            pdf_url = _extract_pdf_url_from_html(r.content, final_url)
            if pdf_url and pdf_url != final_url:
                logger.info(f"_try_doi_resolve: PDF link en landing page → {pdf_url}")
                success = download_pdf_from_url(pdf_url, filepath)
                if success:
                    return True, "doi_resolve:landing_scrape"

        logger.debug(f"_try_doi_resolve: no PDF encontrado para {doi} (final URL: {final_url})")
        return False, "doi_resolve:no_pdf_found"

    except requests.exceptions.Timeout:
        logger.debug(f"_try_doi_resolve: timeout para {doi}")
        return False, "doi_resolve:timeout"
    except Exception as e:
        logger.debug(f"_try_doi_resolve error para {doi}: {e}")
        return False, "doi_resolve:error"


def _try_europepmc(doi: str, filepath: Path) -> tuple[bool, str]:
    """
    Busca el artículo en Europe PMC (acceso OA a literatura biomédica).
    Útil para artículos de salud, biología, medicina.

    Returns:
        (success: bool, strategy_name: str)
    """
    try:
        # Buscar por DOI en Europe PMC
        search_url = f"https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:{quote(doi, safe='')}&format=json&resulttype=core"
        r = requests.get(search_url, timeout=15, headers={"User-Agent": _BROWSER_UA})
        if r.status_code != 200:
            return False, "europepmc:http_error"

        data = r.json()
        results = data.get("resultList", {}).get("result", [])
        if not results:
            return False, "europepmc:not_found"

        article = results[0]
        pmcid = article.get("pmcid")
        if pmcid:
            pdf_url = f"https://europepmc.org/backend/ptpmcrender.fcgi?accid={pmcid}&blobtype=pdf"
            logger.info(f"_try_europepmc: trying PMC PDF {pdf_url}")
            success = download_pdf_from_url(pdf_url, filepath)
            if success:
                return True, "europepmc:pmc_pdf"

        # Si tiene fullTextUrlList
        url_list = article.get("fullTextUrlList", {}).get("fullTextUrl", [])
        for entry in url_list:
            availability = entry.get("availability", "")
            url_val = entry.get("url", "")
            if availability in ("Open access", "Free") and url_val:
                success = download_pdf_from_url(url_val, filepath)
                if success:
                    return True, "europepmc:fulltext_url"

    except Exception as e:
        logger.debug(f"_try_europepmc error para {doi}: {e}")
    return False, "europepmc:not_available"


def download_smart(doi: str, title: str, ref_id: int, db=None) -> dict:
    """
    Descarga inteligente con cadena de estrategias:
      1. Unpaywall        — OA verificado, más confiable
      2. Semantic Scholar — API gratuita, buena cobertura OA
      3. CrossRef         — full-text links del publisher
      4. Europe PMC       — literatura biomédica OA
      5. Publisher patterns — URLs directas por prefijo DOI (requiere acceso institucional)
      6. DOI resolve      — scraping de landing page del publisher

    Args:
        doi:    DOI del artículo
        title:  Título (para el nombre de archivo)
        ref_id: ID de la referencia en BD
        db:     Sesión SQLAlchemy (solo para actualizar pdf_file si se provee)

    Returns:
        {
            "ok":         bool,
            "strategy":   str,    # estrategia que tuvo éxito (o "failed")
            "pdf_url":    str | None,
            "filepath":   str | None,
            "filename":   str | None,
            "message":    str,
        }
    """
    if not doi:
        return {"ok": False, "strategy": "no_doi", "pdf_url": None,
                "filepath": None, "filename": None, "message": "Sin DOI"}

    filename = normalize_filename(title, ref_id)
    filepath = PDF_DIR / filename

    # ── 1. Unpaywall ──────────────────────────────────────────────
    logger.info(f"download_smart [{ref_id}] Estrategia 1: Unpaywall")
    oa = check_oa(doi)
    if oa.get("is_oa") and oa.get("pdf_url"):
        if download_pdf_from_url(oa["pdf_url"], filepath):
            _update_ref_pdf(ref_id, filename, db)
            return {"ok": True, "strategy": "unpaywall",
                    "pdf_url": oa["pdf_url"], "filepath": str(filepath),
                    "filename": filename, "message": "Descargado via Unpaywall (OA)"}
    time.sleep(0.1)

    # ── 2. Semantic Scholar ───────────────────────────────────────
    logger.info(f"download_smart [{ref_id}] Estrategia 2: Semantic Scholar")
    ss = check_semantic_scholar(doi)
    if ss.get("pdf_url"):
        if download_pdf_from_url(ss["pdf_url"], filepath):
            _update_ref_pdf(ref_id, filename, db)
            return {"ok": True, "strategy": "semantic_scholar",
                    "pdf_url": ss["pdf_url"], "filepath": str(filepath),
                    "filename": filename, "message": "Descargado via Semantic Scholar"}
    time.sleep(0.1)

    # ── 3. CrossRef ───────────────────────────────────────────────
    logger.info(f"download_smart [{ref_id}] Estrategia 3: CrossRef")
    cr = check_crossref(doi)
    if cr.get("pdf_url"):
        if download_pdf_from_url(cr["pdf_url"], filepath):
            _update_ref_pdf(ref_id, filename, db)
            return {"ok": True, "strategy": "crossref",
                    "pdf_url": cr["pdf_url"], "filepath": str(filepath),
                    "filename": filename, "message": "Descargado via CrossRef"}
    time.sleep(0.1)

    # ── 4. Europe PMC ─────────────────────────────────────────────
    logger.info(f"download_smart [{ref_id}] Estrategia 4: Europe PMC")
    ok_epmc, strat_epmc = _try_europepmc(doi, filepath)
    if ok_epmc:
        _update_ref_pdf(ref_id, filename, db)
        return {"ok": True, "strategy": strat_epmc,
                "pdf_url": None, "filepath": str(filepath),
                "filename": filename, "message": "Descargado via Europe PMC"}
    time.sleep(0.1)

    # ── 5. Publisher patterns (red universitaria) ─────────────────
    logger.info(f"download_smart [{ref_id}] Estrategia 5: Publisher patterns")
    ok_pub, strat_pub = _try_publisher_patterns(doi, filepath)
    if ok_pub:
        _update_ref_pdf(ref_id, filename, db)
        return {"ok": True, "strategy": strat_pub,
                "pdf_url": None, "filepath": str(filepath),
                "filename": filename, "message": f"Descargado via patrón de publisher ({strat_pub})"}
    time.sleep(0.15)

    # ── 6. DOI resolve + scraping ─────────────────────────────────
    logger.info(f"download_smart [{ref_id}] Estrategia 6: DOI resolve")
    ok_doi, strat_doi = _try_doi_resolve(doi, filepath)
    if ok_doi:
        _update_ref_pdf(ref_id, filename, db)
        return {"ok": True, "strategy": strat_doi,
                "pdf_url": None, "filepath": str(filepath),
                "filename": filename, "message": "Descargado via resolución DOI + scraping"}

    # ── Todas las estrategias fallaron ────────────────────────────
    return {
        "ok": False,
        "strategy": "failed",
        "pdf_url": None,
        "filepath": None,
        "filename": None,
        "message": (
            "No se pudo descargar el PDF con ninguna estrategia. "
            "Si el artículo es de pago, descárgalo manualmente desde tu institución "
            "y súbelo con el botón 'Agregar PDF'."
        ),
    }


def _update_ref_pdf(ref_id: int, filename: str, db) -> None:
    """Actualiza reference.pdf_file en BD si se provee sesión."""
    if db is None:
        return
    try:
        from models.reference import Reference as _Ref
        ref = db.query(_Ref).filter(_Ref.id == ref_id).first()
        if ref:
            ref.pdf_file = filename
            db.commit()
    except Exception as e:
        logger.error(f"_update_ref_pdf error: {e}")


# ── Descarga masiva ────────────────────────────────────────────

def bulk_download_oa(search_id: int, db: Session, batch_limit: int = 100) -> dict:
    """
    Para las referencias de una búsqueda sin PDF y con DOI:
      1. Consulta Unpaywall para verificar OA
      2. Descarga los PDFs disponibles
      3. Actualiza la BD

    Args:
        search_id: ID de la búsqueda
        db: Sesión SQLAlchemy
        batch_limit: Máximo de referencias a procesar en esta llamada

    Returns:
        {
            checked, oa_found, downloaded, not_available,
            no_doi, download_errors, skipped_with_pdf,
            landing_page_only  ← nuevo: OA pero sin url_for_pdf directo
        }
    """
    # Refs de esta búsqueda sin PDF y CON DOI
    refs_to_check = (
        db.query(Reference)
        .join(SearchReference, SearchReference.reference_id == Reference.id)
        .filter(SearchReference.search_id == search_id)
        .filter(Reference.pdf_file.is_(None))
        .filter(Reference.doi.isnot(None))
        .filter(Reference.doi != "")
        .limit(batch_limit)
        .all()
    )

    # Refs sin DOI (no se pueden verificar)
    no_doi_count = (
        db.query(Reference)
        .join(SearchReference, SearchReference.reference_id == Reference.id)
        .filter(SearchReference.search_id == search_id)
        .filter(Reference.pdf_file.is_(None))
        .filter((Reference.doi.is_(None)) | (Reference.doi == ""))
        .count()
    )

    # Refs que ya tienen PDF
    skipped_with_pdf = (
        db.query(Reference)
        .join(SearchReference, SearchReference.reference_id == Reference.id)
        .filter(SearchReference.search_id == search_id)
        .filter(Reference.pdf_file.isnot(None))
        .count()
    )

    stats = {
        "checked": 0,
        "oa_found": 0,
        "downloaded": 0,
        "not_available": 0,
        "download_errors": 0,
        "landing_page_only": 0,
        "no_doi": no_doi_count,
        "skipped_with_pdf": skipped_with_pdf,
        "batch_limit": batch_limit,
    }

    for ref in refs_to_check:
        stats["checked"] += 1
        oa = check_oa(ref.doi)
        logger.debug(f"OA check ref {ref.id} doi={ref.doi}: {oa}")

        if not oa["is_oa"] or not oa["pdf_url"]:
            stats["not_available"] += 1
            time.sleep(0.05)
            continue

        stats["oa_found"] += 1

        # Contabilizar si solo tiene landing page (sin url_for_pdf directo)
        # Igualmente intentamos: el HTML parser puede encontrar el PDF dentro
        if not oa["has_direct_pdf"]:
            stats["landing_page_only"] += 1

        filename = normalize_filename(ref.title, ref.id)
        filepath = PDF_DIR / filename

        success = download_pdf_from_url(oa["pdf_url"], filepath)
        if success:
            ref.pdf_file = filename
            db.commit()
            stats["downloaded"] += 1
            logger.info(f"Downloaded PDF for ref {ref.id}: {filename}")
        else:
            stats["download_errors"] += 1
            logger.warning(f"Failed to download PDF for ref {ref.id} from {oa['pdf_url']}")

        time.sleep(0.15)  # pausa para no saturar servidores

    return stats
