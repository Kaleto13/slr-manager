"""
stats.py — Estadísticas PRISMA + gráficos + exportadores

Endpoints:
  GET  /stats/{search_id}/prisma       → conteos PRISMA 2020
  GET  /stats/{search_id}/charts       → datos para gráficos (año, fuente, screening)
  GET  /stats/{search_id}/export/csv   → CSV completo (todos los campos)
  GET  /stats/{search_id}/export/bibtex → BibTeX .bib
  GET  /stats/{search_id}/export/ris   → RIS .ris
"""

import csv
import io
import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, PlainTextResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db

router = APIRouter(prefix="/stats", tags=["stats"])


# ─────────────────────────── helpers ────────────────────────────

def _get_search_or_404(search_id: int, db: Session):
    row = db.execute(
        text("SELECT id, name FROM searches WHERE id = :sid"),
        {"sid": search_id}
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")
    return row


def _ref_ids_for_search(search_id: int, db: Session) -> list[int]:
    rows = db.execute(
        text("SELECT reference_id FROM search_references WHERE search_id = :sid"),
        {"sid": search_id}
    ).fetchall()
    return [r[0] for r in rows]


# ─────────────────────────── PRISMA ─────────────────────────────

@router.get("/{search_id}/prisma")
def get_prisma(search_id: int, db: Session = Depends(get_db)):
    _get_search_or_404(search_id, db)
    ref_ids = _ref_ids_for_search(search_id, db)

    total_identified = len(ref_ids)
    if total_identified == 0:
        return _empty_prisma()

    # Duplicados confirmados dentro de este search
    dup_count = db.execute(
        text("""
            SELECT COUNT(*) FROM duplicates
            WHERE reference_id = ANY(:ids)
              AND status = 'confirmed'
        """),
        {"ids": ref_ids}
    ).scalar() or 0

    screened = total_identified - dup_count
    non_dup_ids_q = db.execute(
        text("""
            SELECT sr.reference_id FROM search_references sr
            WHERE sr.search_id = :sid
              AND sr.reference_id NOT IN (
                  SELECT d.reference_id FROM duplicates d
                  WHERE d.reference_id = ANY(:ids)
                    AND d.status = 'confirmed'
              )
        """),
        {"sid": search_id, "ids": ref_ids}
    ).fetchall()
    non_dup_ids = [r[0] for r in non_dup_ids_q]

    # Screening title_abstract
    ta_rows = db.execute(
        text("""
            SELECT decision, COUNT(*) FROM screening_decisions
            WHERE search_id = :sid
              AND phase = 'title_abstract'
              AND reference_id = ANY(:nd_ids)
            GROUP BY decision
        """),
        {"sid": search_id, "nd_ids": non_dup_ids or [0]}
    ).fetchall()
    ta = {r[0]: r[1] for r in ta_rows}
    ta_included  = ta.get("include", 0)
    ta_excluded  = ta.get("exclude", 0)
    ta_pending   = screened - ta_included - ta_excluded

    # Screening full_text (elegibilidad)
    ft_rows = db.execute(
        text("""
            SELECT decision, COUNT(*) FROM screening_decisions
            WHERE search_id = :sid
              AND phase = 'full_text'
              AND reference_id = ANY(:nd_ids)
            GROUP BY decision
        """),
        {"sid": search_id, "nd_ids": non_dup_ids or [0]}
    ).fetchall()
    ft = {r[0]: r[1] for r in ft_rows}
    ft_assessed = sum(ft.values())
    ft_included = ft.get("include", 0)
    ft_excluded = ft.get("exclude", 0)

    # PDFs descargados
    pdf_count = db.execute(
        text("""
            SELECT COUNT(*) FROM paper_texts
            WHERE reference_id = ANY(:nd_ids)
              AND plain_text IS NOT NULL
              AND plain_text != ''
        """),
        {"nd_ids": non_dup_ids or [0]}
    ).scalar() or 0

    # Final included: si hay fase full_text, usar esa; si no, usar title_abstract include
    if ft_assessed > 0:
        final_included = ft_included
    else:
        final_included = ta_included

    # Criterios de exclusión en title_abstract
    excl_criteria_rows = db.execute(
        text("""
            SELECT sc.label, COUNT(*) as cnt
            FROM screening_decisions sd
            LEFT JOIN screening_criteria sc ON sd.criterion_id = sc.id
            WHERE sd.search_id = :sid
              AND sd.phase = 'title_abstract'
              AND sd.decision = 'exclude'
              AND sd.reference_id = ANY(:nd_ids)
            GROUP BY sc.label
            ORDER BY cnt DESC
        """),
        {"sid": search_id, "nd_ids": non_dup_ids or [0]}
    ).fetchall()
    excl_criteria = [{"label": r[0] or "Sin criterio", "count": r[1]} for r in excl_criteria_rows]

    return {
        "search_id": search_id,
        "identification": {
            "total_identified": total_identified,
            "duplicates_removed": dup_count,
        },
        "screening": {
            "screened": screened,
            "excluded": ta_excluded,
            "included": ta_included,
            "pending": ta_pending,
            "exclusion_criteria": excl_criteria,
        },
        "eligibility": {
            "assessed": ft_assessed if ft_assessed > 0 else ta_included,
            "excluded": ft_excluded,
            "included": ft_included if ft_assessed > 0 else ta_included,
            "has_full_text_phase": ft_assessed > 0,
        },
        "included": {
            "final": final_included,
            "with_pdf": pdf_count,
        },
    }


def _empty_prisma():
    return {
        "identification": {"total_identified": 0, "duplicates_removed": 0},
        "screening": {"screened": 0, "excluded": 0, "included": 0, "pending": 0, "exclusion_criteria": []},
        "eligibility": {"assessed": 0, "excluded": 0, "included": 0, "has_full_text_phase": False},
        "included": {"final": 0, "with_pdf": 0},
    }


# ─────────────────────────── CHARTS ─────────────────────────────

@router.get("/{search_id}/charts")
def get_charts(search_id: int, db: Session = Depends(get_db)):
    _get_search_or_404(search_id, db)
    ref_ids = _ref_ids_for_search(search_id, db)
    if not ref_ids:
        return {"by_year": [], "by_source": [], "by_decision": [], "by_journal": []}

    # Por año
    year_rows = db.execute(
        text("""
            SELECT COALESCE(year::text, 'Sin año') as yr, COUNT(*) as cnt
            FROM "references"
            WHERE id = ANY(:ids) AND year IS NOT NULL
            GROUP BY year
            ORDER BY year ASC
        """),
        {"ids": ref_ids}
    ).fetchall()
    by_year = [{"year": r[0], "count": r[1]} for r in year_rows]

    # Por fuente (base de datos)
    source_rows = db.execute(
        text("""
            SELECT COALESCE(source, 'Sin fuente') as src, COUNT(*) as cnt
            FROM search_references
            WHERE search_id = :sid
            GROUP BY source
            ORDER BY cnt DESC
        """),
        {"sid": search_id}
    ).fetchall()
    by_source = [{"source": r[0], "count": r[1]} for r in source_rows]

    # Por decisión de screening (title_abstract)
    decision_rows = db.execute(
        text("""
            SELECT COALESCE(decision, 'pending') as dec, COUNT(*) as cnt
            FROM screening_decisions
            WHERE search_id = :sid AND phase = 'title_abstract'
              AND reference_id = ANY(:ids)
            GROUP BY decision
        """),
        {"sid": search_id, "ids": ref_ids}
    ).fetchall()
    # Añadir los que no tienen decisión (pending real)
    decided_ids = db.execute(
        text("""
            SELECT COUNT(DISTINCT reference_id) FROM screening_decisions
            WHERE search_id = :sid AND phase = 'title_abstract'
              AND reference_id = ANY(:ids)
        """),
        {"sid": search_id, "ids": ref_ids}
    ).scalar() or 0
    pending_real = len(ref_ids) - decided_ids
    by_decision = [{"decision": r[0], "count": r[1]} for r in decision_rows]
    if pending_real > 0:
        existing_pending = next((d for d in by_decision if d["decision"] == "pending"), None)
        if existing_pending:
            existing_pending["count"] += pending_real
        else:
            by_decision.append({"decision": "pending", "count": pending_real})

    # Top revistas/journals
    journal_rows = db.execute(
        text("""
            SELECT COALESCE(journal, 'Sin revista') as j, COUNT(*) as cnt
            FROM "references"
            WHERE id = ANY(:ids) AND journal IS NOT NULL AND journal != ''
            GROUP BY journal
            ORDER BY cnt DESC
            LIMIT 15
        """),
        {"ids": ref_ids}
    ).fetchall()
    by_journal = [{"journal": r[0], "count": r[1]} for r in journal_rows]

    return {
        "by_year": by_year,
        "by_source": by_source,
        "by_decision": by_decision,
        "by_journal": by_journal,
    }


# ─────────────────────────── EXPORT CSV ─────────────────────────

@router.get("/{search_id}/export/csv")
def export_csv(search_id: int, db: Session = Depends(get_db)):
    search = _get_search_or_404(search_id, db)
    ref_ids = _ref_ids_for_search(search_id, db)
    if not ref_ids:
        raise HTTPException(status_code=404, detail="No hay referencias en esta búsqueda")

    rows = db.execute(
        text("""
            SELECT
                r.id, r.title, r.authors, r.year, r.journal,
                r.doi, r.url, r.keywords, r.abstract,
                sr.source,
                COALESCE(
                    (SELECT decision FROM screening_decisions
                     WHERE reference_id = r.id AND search_id = :sid AND phase = 'title_abstract'
                     LIMIT 1),
                    'pending'
                ) as screening_decision,
                COALESCE(
                    (SELECT sc.label FROM screening_decisions sd
                     LEFT JOIN screening_criteria sc ON sd.criterion_id = sc.id
                     WHERE sd.reference_id = r.id AND sd.search_id = :sid AND sd.phase = 'title_abstract'
                     LIMIT 1),
                    ''
                ) as exclusion_criterion,
                CASE WHEN EXISTS(
                    SELECT 1 FROM paper_texts pt WHERE pt.reference_id = r.id
                ) THEN 'Sí' ELSE 'No' END as has_pdf
            FROM "references" r
            JOIN search_references sr ON sr.reference_id = r.id AND sr.search_id = :sid
            WHERE r.id = ANY(:ids)
            ORDER BY r.year DESC NULLS LAST, r.title ASC
        """),
        {"sid": search_id, "ids": ref_ids}
    ).fetchall()

    # Obtener campos de extracción personalizados
    custom_fields = db.execute(
        text("SELECT id, label FROM custom_fields WHERE search_id = :sid ORDER BY position"),
        {"sid": search_id}
    ).fetchall()

    output = io.StringIO()
    writer = csv.writer(output, delimiter='|', quoting=csv.QUOTE_ALL)

    # Cabecera
    headers = ["ID", "Título", "Autores", "Año", "Revista", "DOI", "URL",
               "Palabras clave", "Resumen", "Base de datos", "Decisión screening",
               "Criterio de exclusión", "Tiene PDF"]
    for cf in custom_fields:
        headers.append(cf[1])
    writer.writerow(headers)

    # Datos
    for row in rows:
        ref_id = row[0]
        data = list(row)
        # Valores de campos personalizados
        for cf in custom_fields:
            fv = db.execute(
                text("SELECT value FROM field_values WHERE reference_id = :rid AND field_id = :fid"),
                {"rid": ref_id, "fid": cf[0]}
            ).fetchone()
            data.append(fv[0] if fv else "")
        writer.writerow(data)

    output.seek(0)
    filename = f"slr_export_{search_id}_{datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ────────────────────────── EXPORT BibTeX ───────────────────────

def _clean_bibtex_key(title: str, year, ref_id: int) -> str:
    """Genera una clave BibTeX tipo Autor2024a."""
    key = re.sub(r"[^\w]", "", (title or "")[:20])
    return f"{key}{year or 'nd'}{ref_id}"


@router.get("/{search_id}/export/bibtex")
def export_bibtex(search_id: int, db: Session = Depends(get_db)):
    search = _get_search_or_404(search_id, db)
    ref_ids = _ref_ids_for_search(search_id, db)
    if not ref_ids:
        raise HTTPException(status_code=404, detail="No hay referencias en esta búsqueda")

    rows = db.execute(
        text("""
            SELECT id, title, authors, year, journal, doi, url, abstract, keywords
            FROM "references"
            WHERE id = ANY(:ids)
            ORDER BY year DESC NULLS LAST, title ASC
        """),
        {"ids": ref_ids}
    ).fetchall()

    lines = []
    lines.append(f"% BibTeX export — SLR-Manager")
    lines.append(f"% Búsqueda: {search[1]}")
    lines.append(f"% Generado: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("")

    for row in rows:
        ref_id, title, authors, year, journal, doi, url, abstract, keywords = row
        key = _clean_bibtex_key(title, year, ref_id)

        # Convertir autores "Last, First; Last2, First2" → "Last, First and Last2, First2"
        authors_bib = ""
        if authors:
            parts = [a.strip() for a in re.split(r";|,\s(?=[A-Z])", authors) if a.strip()]
            authors_bib = " and ".join(parts)

        lines.append(f"@article{{{key},")
        if title:
            lines.append(f'  title     = {{{title}}},')
        if authors_bib:
            lines.append(f'  author    = {{{authors_bib}}},')
        if year:
            lines.append(f'  year      = {{{year}}},')
        if journal:
            lines.append(f'  journal   = {{{journal}}},')
        if doi:
            lines.append(f'  doi       = {{{doi}}},')
        if url:
            lines.append(f'  url       = {{{url}}},')
        if abstract:
            abs_clean = abstract.replace("{", "").replace("}", "").replace("\n", " ")
            lines.append(f'  abstract  = {{{abs_clean[:500]}}},')
        if keywords:
            lines.append(f'  keywords  = {{{keywords}}},')
        lines.append("}")
        lines.append("")

    content = "\n".join(lines)
    filename = f"slr_export_{search_id}_{datetime.now().strftime('%Y%m%d')}.bib"
    return PlainTextResponse(
        content=content,
        headers={"Content-Disposition": f'attachment; filename="{filename}"',
                 "Content-Type": "text/plain; charset=utf-8"}
    )


# ────────────────────────── EXPORT RIS ──────────────────────────

@router.get("/{search_id}/export/ris")
def export_ris(search_id: int, db: Session = Depends(get_db)):
    search = _get_search_or_404(search_id, db)
    ref_ids = _ref_ids_for_search(search_id, db)
    if not ref_ids:
        raise HTTPException(status_code=404, detail="No hay referencias en esta búsqueda")

    rows = db.execute(
        text("""
            SELECT id, title, authors, year, journal, doi, url, abstract, keywords
            FROM "references"
            WHERE id = ANY(:ids)
            ORDER BY year DESC NULLS LAST, title ASC
        """),
        {"ids": ref_ids}
    ).fetchall()

    lines = []
    for row in rows:
        ref_id, title, authors, year, journal, doi, url, abstract, keywords = row

        lines.append("TY  - JOUR")
        if title:
            lines.append(f"TI  - {title}")
        if authors:
            for author in re.split(r";", authors):
                a = author.strip()
                if a:
                    lines.append(f"AU  - {a}")
        if year:
            lines.append(f"PY  - {year}")
        if journal:
            lines.append(f"JO  - {journal}")
        if doi:
            lines.append(f"DO  - {doi}")
        if url:
            lines.append(f"UR  - {url}")
        if abstract:
            lines.append(f"AB  - {abstract[:1000]}")
        if keywords:
            for kw in re.split(r"[;,]", keywords):
                k = kw.strip()
                if k:
                    lines.append(f"KW  - {k}")
        lines.append("ER  - ")
        lines.append("")

    content = "\n".join(lines)
    filename = f"slr_export_{search_id}_{datetime.now().strftime('%Y%m%d')}.ris"
    return PlainTextResponse(
        content=content,
        headers={"Content-Disposition": f'attachment; filename="{filename}"',
                 "Content-Type": "text/plain; charset=utf-8"}
    )


# ─────────────────────── LIST SEARCHES ──────────────────────────

@router.get("/searches")
def list_searches_for_stats(db: Session = Depends(get_db)):
    """Lista de búsquedas con conteo de referencias (para el selector)."""
    rows = db.execute(
        text("""
            SELECT s.id, s.name,
                   COUNT(sr.reference_id) as ref_count
            FROM searches s
            LEFT JOIN search_references sr ON sr.search_id = s.id
            GROUP BY s.id, s.name
            ORDER BY s.created_at DESC
        """)
    ).fetchall()
    return [{"id": r[0], "name": r[1], "ref_count": r[2]} for r in rows]
