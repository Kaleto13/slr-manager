from sqlalchemy import Column, Integer, String, ForeignKey, Index
from sqlalchemy.orm import relationship
from database import Base


class SearchTerm(Base):
    __tablename__ = "search_terms"

    id = Column(Integer, primary_key=True, index=True)
    search_id = Column(Integer, ForeignKey("searches.id", ondelete="CASCADE"), nullable=False)
    term = Column(String(255), nullable=False)

    # Relationships
    search = relationship("Search", back_populates="search_terms")
    term_matches = relationship("TermMatch", back_populates="search_term", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_search_terms_search_term", "search_id", "term"),
    )
