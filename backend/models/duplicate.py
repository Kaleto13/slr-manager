"""
Modelo para registrar pares de referencias duplicadas.
Una fila representa: ref_id ES DUPLICADO DE canonical_id.
La referencia canonical es la que se conserva; la duplicada queda marcada.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Duplicate(Base):
    __tablename__ = "duplicates"

    id = Column(Integer, primary_key=True, index=True)

    # Referencia que se considera duplicada
    reference_id = Column(
        Integer,
        ForeignKey("references.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Referencia canónica (la que se conserva)
    canonical_id = Column(
        Integer,
        ForeignKey("references.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Método de detección: "doi_exact" | "title_normalized" | "manual"
    detection_method = Column(String(50), nullable=False, default="doi_exact")

    # Estado: "pending_review" | "confirmed" | "rejected"
    status = Column(String(30), nullable=False, default="confirmed")

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # No puede haber dos filas con el mismo par (reference_id, canonical_id)
    __table_args__ = (
        UniqueConstraint("reference_id", "canonical_id", name="uq_duplicate_pair"),
    )

    # Relaciones
    reference = relationship(
        "Reference",
        foreign_keys=[reference_id],
        backref="duplicate_of",
    )
    canonical = relationship(
        "Reference",
        foreign_keys=[canonical_id],
        backref="has_duplicates",
    )
