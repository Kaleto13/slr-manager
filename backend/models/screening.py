from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Index, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class ScreeningCriteria(Base):
    """Criterios de inclusión/exclusión para el screening."""
    __tablename__ = "screening_criteria"

    id = Column(Integer, primary_key=True, index=True)
    label = Column(String(200), nullable=False)          # Ej: "Fuera del alcance del tema"
    description = Column(Text, nullable=True)
    type = Column(String(20), default="exclusion")       # "exclusion" | "inclusion"
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    decisions = relationship("ScreeningDecision", back_populates="criterion")


class ScreeningDecision(Base):
    """Decisión de screening para una referencia en un búsqueda y ronda determinada."""
    __tablename__ = "screening_decisions"

    id = Column(Integer, primary_key=True, index=True)
    reference_id = Column(Integer, ForeignKey("references.id", ondelete="CASCADE"), nullable=False)
    search_id    = Column(Integer, ForeignKey("searches.id",   ondelete="CASCADE"), nullable=False)
    phase        = Column(String(50), nullable=False)          # "title_abstract" | "full_text"
    decision     = Column(String(20), default="pending")       # "pending"|"include"|"exclude"|"maybe"
    criterion_id  = Column(Integer, ForeignKey("screening_criteria.id", ondelete="SET NULL"), nullable=True)
    criterion_ids = Column(JSON, nullable=True, default=list)   # lista de IDs [1, 3, ...]
    notes         = Column(Text, nullable=True)
    decided_at   = Column(DateTime(timezone=True), nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    reference = relationship("Reference",          back_populates="screening_decisions")
    search    = relationship("Search",             back_populates="screening_decisions")
    criterion = relationship("ScreeningCriteria",  back_populates="decisions")

    __table_args__ = (
        Index("ix_screening_ref_search_phase", "reference_id", "search_id", "phase", unique=True),
    )
