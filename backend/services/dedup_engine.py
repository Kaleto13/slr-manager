"""
Motor de deduplicación para SLR-Manager.

Estrategias (en orden de precisión):
  1. DOI exacto — máxima confianza
  2. Título normalizado exacto — alta confianza

La referencia con ID más bajo se trata como la canónica (la original).
Las referencias con ID mayor se marcan como duplicadas.
"""

import re
import unicodedata
from collections import defaultdict
from sqlalchemy.orm import Session
from sqlalchemy import func
from models.reference import Reference
from models.duplicate import Duplicate


# ── Normalización de texto ─────────────────────────────────────

def normalize_title(title: str) -> str:
    """
    Normaliza un título para comparación:
    - Lowercase
    - Sin acentos/diacríticos
    - Sin caracteres especiales (solo letras y números)
    - Sin espacios extra
    """
    if not title:
        return ""
    # Descomponer unicode y eliminar marcas diacríticas
    nfkd = unicodedata.normalize("NFKD", title)
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    # Solo alfanumérico y espacios
    cleaned = re.sub(r"[^a-z0-9\s]", "", ascii_str.lower())
    # Colapsar espacios múltiples
    return re.sub(r"\s+", " ", cleaned).strip()


def ensure_title_normalized(db: Session) -> int:
    """
    Rellena title_normalized para referencias que no lo tengan.
    Retorna cuántas se actualizaron.
    """
    refs = db.query(Reference).filter(
        (Reference.title_normalized.is_(None)) | (Reference.title_normalized == "")
    ).all()
    count = 0
    for ref in refs:
        normalized = normalize_title(ref.title)
        if normalized:
            ref.title_normalized = normalized
            count += 1
    if count:
        db.commit()
    return count


# ── Detección de duplicados ────────────────────────────────────

def find_duplicates(search_id: int | None, db: Session) -> dict:
    """
    Detecta duplicados en la BD.

    Si search_id se proporciona, busca solo dentro de las referencias
    de esa búsqueda. Si es None, busca en toda la BD.

    Retorna:
    {
        "pairs": [
            {
                "method": "doi_exact" | "title_normalized",
                "canonical": {id, title, doi, year, authors},
                "duplicate": {id, title, doi, year, authors},
                "already_marked": bool
            }
        ],
        "total_references_checked": int,
        "doi_duplicates": int,
        "title_duplicates": int,
        "already_marked": int,
    }
    """
    # Asegurar que todos tienen title_normalized
    ensure_title_normalized(db)

    # Obtener referencias a analizar
    query = db.query(Reference)
    if search_id is not None:
        from models.search_reference import SearchReference
        query = query.join(
            SearchReference, SearchReference.reference_id == Reference.id
        ).filter(SearchReference.search_id == search_id)
    refs = query.all()

    ref_ids = {r.id for r in refs}
    refs_by_id = {r.id: r for r in refs}

    # Duplicados ya marcados
    existing = db.query(Duplicate).filter(
        Duplicate.reference_id.in_(ref_ids)
    ).all()
    already_marked_pairs = {(d.reference_id, d.canonical_id) for d in existing}

    pairs = []
    doi_count = 0
    title_count = 0

    # ── 1. Duplicados por DOI exacto ───────────────────────────
    doi_groups: dict[str, list[int]] = defaultdict(list)
    for ref in refs:
        if ref.doi and ref.doi.strip():
            doi_groups[ref.doi.strip().lower()].append(ref.id)

    for doi, ids in doi_groups.items():
        if len(ids) < 2:
            continue
        ids_sorted = sorted(ids)
        canonical_id = ids_sorted[0]
        for dup_id in ids_sorted[1:]:
            already = (dup_id, canonical_id) in already_marked_pairs
            pairs.append({
                "method": "doi_exact",
                "canonical": _ref_summary(refs_by_id[canonical_id]),
                "duplicate": _ref_summary(refs_by_id[dup_id]),
                "already_marked": already,
            })
            doi_count += 1

    # ── 2. Duplicados por título normalizado (excluyendo los ya encontrados por DOI)
    title_groups: dict[str, list[int]] = defaultdict(list)
    for ref in refs:
        norm = ref.title_normalized or normalize_title(ref.title or "")
        if norm and len(norm) > 10:  # títulos muy cortos no son confiables
            title_groups[norm].append(ref.id)

    # IDs ya emparejados por DOI (para no duplicar)
    doi_paired_ids = set()
    for p in pairs:
        doi_paired_ids.add(p["duplicate"]["id"])

    for norm, ids in title_groups.items():
        if len(ids) < 2:
            continue
        ids_sorted = sorted(ids)
        canonical_id = ids_sorted[0]
        for dup_id in ids_sorted[1:]:
            if dup_id in doi_paired_ids:
                continue  # ya encontrado por DOI
            already = (dup_id, canonical_id) in already_marked_pairs
            pairs.append({
                "method": "title_normalized",
                "canonical": _ref_summary(refs_by_id[canonical_id]),
                "duplicate": _ref_summary(refs_by_id[dup_id]),
                "already_marked": already,
            })
            title_count += 1

    return {
        "pairs": pairs,
        "total_references_checked": len(refs),
        "doi_duplicates": doi_count,
        "title_duplicates": title_count,
        "already_marked": sum(1 for p in pairs if p["already_marked"]),
        "new_duplicates": sum(1 for p in pairs if not p["already_marked"]),
    }


def _ref_summary(ref: Reference) -> dict:
    return {
        "id":       ref.id,
        "title":    ref.title,
        "authors":  ref.authors,
        "year":     ref.year,
        "doi":      ref.doi,
        "journal":  ref.journal,
        "abstract": ref.abstract,
        "keywords": ref.keywords,
        "url":      ref.url,
    }


# ── Fuzzy matching ─────────────────────────────────────────────

def find_duplicates_fuzzy(
    search_id: int | None,
    db: Session,
    threshold: int = 90,
) -> dict:
    """
    Detecta duplicados usando similitud fuzzy de títulos (rapidfuzz).

    Solo compara referencias que NO tienen DOI (para evitar redundancia
    con find_duplicates que ya cubre DOI exacto). Aplica token_set_ratio
    que es robusto a palabras reordenadas y palabras extra.

    threshold: 0-100 (recomendado 85-95)
    """
    try:
        from rapidfuzz import fuzz as rfuzz
    except ImportError:
        return {
            "error": "rapidfuzz no instalado. Ejecuta: pip install rapidfuzz",
            "pairs": [],
        }

    ensure_title_normalized(db)

    # Obtener referencias a analizar
    query = db.query(Reference)
    if search_id is not None:
        from models.search_reference import SearchReference
        query = query.join(
            SearchReference, SearchReference.reference_id == Reference.id
        ).filter(SearchReference.search_id == search_id)
    refs = query.all()

    # Duplicados ya marcados
    ref_ids = {r.id for r in refs}
    existing = db.query(Duplicate).filter(
        Duplicate.reference_id.in_(ref_ids)
    ).all()
    already_marked_pairs = {(d.reference_id, d.canonical_id) for d in existing}

    # Solo refs SIN doi (las que tienen DOI ya las cubre find_duplicates)
    refs_no_doi = [r for r in refs if not (r.doi and r.doi.strip())]

    pairs = []
    seen_pairs: set[tuple[int, int]] = set()  # evitar duplicados en el resultado

    for i, ref_a in enumerate(refs_no_doi):
        norm_a = ref_a.title_normalized or normalize_title(ref_a.title or "")
        if not norm_a or len(norm_a) < 15:
            continue

        for ref_b in refs_no_doi[i + 1:]:
            norm_b = ref_b.title_normalized or normalize_title(ref_b.title or "")
            if not norm_b or len(norm_b) < 15:
                continue

            score = rfuzz.token_set_ratio(norm_a, norm_b)
            if score < threshold:
                continue

            # El de ID menor es canónico
            can_id = min(ref_a.id, ref_b.id)
            dup_id = max(ref_a.id, ref_b.id)

            if (can_id, dup_id) in seen_pairs:
                continue
            seen_pairs.add((can_id, dup_id))

            already = (dup_id, can_id) in already_marked_pairs
            refs_by_id = {r.id: r for r in [ref_a, ref_b]}
            pairs.append({
                "method":       "fuzzy_title",
                "similarity":   round(score, 1),
                "canonical":    _ref_summary(refs_by_id[can_id]),
                "duplicate":    _ref_summary(refs_by_id[dup_id]),
                "already_marked": already,
            })

    # Ordenar por mayor similitud primero
    pairs.sort(key=lambda p: p["similarity"], reverse=True)

    return {
        "pairs":                   pairs,
        "total_references_checked": len(refs_no_doi),
        "threshold":               threshold,
        "fuzzy_duplicates":        len(pairs),
        "new_duplicates":          sum(1 for p in pairs if not p["already_marked"]),
        "already_marked":          sum(1 for p in pairs if p["already_marked"]),
    }


# ── Marcado de duplicados ──────────────────────────────────────

def mark_duplicate(
    reference_id: int,
    canonical_id: int,
    detection_method: str,
    db: Session,
) -> dict:
    """
    Marca reference_id como duplicado de canonical_id.
    Si ya existe el par, no hace nada (idempotente).
    """
    if reference_id == canonical_id:
        return {"error": "Un artículo no puede ser duplicado de sí mismo"}

    ref = db.query(Reference).filter(Reference.id == reference_id).first()
    canonical = db.query(Reference).filter(Reference.id == canonical_id).first()
    if not ref:
        return {"error": f"Referencia {reference_id} no encontrada"}
    if not canonical:
        return {"error": f"Referencia canónica {canonical_id} no encontrada"}

    # Verificar si ya existe
    existing = db.query(Duplicate).filter(
        Duplicate.reference_id == reference_id,
        Duplicate.canonical_id == canonical_id,
    ).first()

    if existing:
        return {"status": "already_exists", "id": existing.id}

    dup = Duplicate(
        reference_id=reference_id,
        canonical_id=canonical_id,
        detection_method=detection_method,
        status="confirmed",
    )
    db.add(dup)
    db.commit()
    db.refresh(dup)
    return {"status": "created", "id": dup.id}


def unmark_duplicate(reference_id: int, canonical_id: int, db: Session) -> dict:
    """
    Elimina la marca de duplicado (el usuario decidió que NO son duplicados).
    """
    dup = db.query(Duplicate).filter(
        Duplicate.reference_id == reference_id,
        Duplicate.canonical_id == canonical_id,
    ).first()
    if not dup:
        return {"status": "not_found"}
    db.delete(dup)
    db.commit()
    return {"status": "deleted"}


def mark_all_found(search_id: int | None, db: Session) -> dict:
    """
    Detecta y marca automáticamente todos los duplicados encontrados
    (sin requerir confirmación manual uno por uno).
    """
    result = find_duplicates(search_id, db)
    marked = 0
    errors = 0
    for pair in result["pairs"]:
        if pair["already_marked"]:
            continue
        r = mark_duplicate(
            reference_id=pair["duplicate"]["id"],
            canonical_id=pair["canonical"]["id"],
            detection_method=pair["method"],
            db=db,
        )
        if "error" in r:
            errors += 1
        else:
            marked += 1
    return {
        "found": result["new_duplicates"],
        "marked": marked,
        "errors": errors,
    }


# ── Reporte ────────────────────────────────────────────────────

def get_report(search_id: int | None, db: Session) -> dict:
    """
    Resumen de duplicados marcados.
    """
    query = db.query(Duplicate)
    total_refs_query = db.query(Reference)

    if search_id is not None:
        from models.search_reference import SearchReference
        ref_ids_sub = (
            db.query(SearchReference.reference_id)
            .filter(SearchReference.search_id == search_id)
            .subquery()
        )
        query = query.filter(Duplicate.reference_id.in_(ref_ids_sub))
        total_refs_query = total_refs_query.join(
            SearchReference, SearchReference.reference_id == Reference.id
        ).filter(SearchReference.search_id == search_id)

    total_refs = total_refs_query.count()
    total_duplicates = query.count()
    doi_dups = query.filter(Duplicate.detection_method == "doi_exact").count()
    title_dups = query.filter(Duplicate.detection_method == "title_normalized").count()

    return {
        "total_references": total_refs,
        "total_duplicates_marked": total_duplicates,
        "by_method": {
            "doi_exact": doi_dups,
            "title_normalized": title_dups,
            "manual": total_duplicates - doi_dups - title_dups,
        },
        "unique_references": total_refs - total_duplicates,
        "duplicate_rate_pct": round(total_duplicates / total_refs * 100, 1) if total_refs else 0,
    }
