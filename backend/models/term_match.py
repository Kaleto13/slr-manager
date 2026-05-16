from sqlalchemy import Column, Integer, ForeignKey, DateTime, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class TermMatch(Base):
    __tablename__ = "term_matches"

    id = Column(Integer, primary_key=True, index=True)
    reference_id = Column(Integer, ForeignKey("references.id", ondelete="CASCADE"), nullable=False)
    search_term_id = Column(Integer, ForeignKey("search_terms.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    reference = relationship("Reference", back_populates="term_matches")
    search_term = relationship("SearchTerm", back_populates="term_matches")

    __table_args__ = (
        Index("ix_term_matches_ref_term", "reference_id", "search_term_id", unique=True),
    )
