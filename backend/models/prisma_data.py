from sqlalchemy import Column, Integer, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class PrismaData(Base):
    """Datos para generación automática del diagrama PRISMA 2020."""
    __tablename__ = "prisma_data"

    id = Column(Integer, primary_key=True, index=True)
    search_id = Column(Integer, ForeignKey("searches.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)

    # Identificación
    records_identified = Column(Integer, default=0)      # Total importados del .bib
    records_removed_duplicates = Column(Integer, default=0)

    # Screening
    records_screened = Column(Integer, default=0)
    records_excluded_title = Column(Integer, default=0)

    # Elegibilidad
    reports_sought = Column(Integer, default=0)
    reports_not_retrieved = Column(Integer, default=0)
    reports_assessed = Column(Integer, default=0)
    reports_excluded = Column(Integer, default=0)

    # Incluidos
    studies_included = Column(Integer, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    search = relationship("Search", back_populates="prisma_data")
