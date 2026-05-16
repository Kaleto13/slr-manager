from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class SearchReference(Base):
    """
    Tabla junction N:N entre searches y references.
    Registra además la fuente (WoS, Scopus, etc.) del .bib que aportó la referencia
    a esta búsqueda, permitiendo múltiples fuentes por búsqueda.
    """
    __tablename__ = "search_references"

    id = Column(Integer, primary_key=True, index=True)
    search_id = Column(Integer, ForeignKey("searches.id", ondelete="CASCADE"), nullable=False)
    reference_id = Column(Integer, ForeignKey("references.id", ondelete="CASCADE"), nullable=False)
    source = Column(String(100), nullable=True)         # Fuente primaria: WoS, Scopus, PubMed…
    sources_json = Column(String(500), nullable=True)   # JSON array con TODAS las fuentes: ["WoS","Scopus"]
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    search = relationship("Search", back_populates="search_references")
    reference = relationship("Reference", back_populates="search_references")

    __table_args__ = (
        Index("ix_search_references_search_ref", "search_id", "reference_id", unique=True),
        Index("ix_search_references_source", "search_id", "source"),
    )
