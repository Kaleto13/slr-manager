from sqlalchemy import Column, Integer, String, Text, DateTime, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Reference(Base):
    __tablename__ = "references"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(Text, nullable=False)
    title_normalized = Column(Text, nullable=True)   # Para deduplicación
    authors = Column(Text, nullable=True)             # "Author1, Author2; ..."
    authors_json = Column(Text, nullable=True)        # JSON array
    year = Column(Integer, nullable=True)
    doi = Column(String(255), nullable=True, index=True)
    journal = Column(Text, nullable=True)
    url = Column(Text, nullable=True)
    abstract = Column(Text, nullable=True)
    keywords = Column(Text, nullable=True)
    keywords_json = Column(Text, nullable=True)       # JSON array
    pdf_file = Column(String(500), nullable=True)     # Ruta local al PDF
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    search_references = relationship("SearchReference", back_populates="reference", cascade="all, delete-orphan")
    field_values = relationship("FieldValue", back_populates="reference", cascade="all, delete-orphan")
    screening_decisions = relationship("ScreeningDecision", back_populates="reference", cascade="all, delete-orphan")
    annotations = relationship("Annotation", back_populates="reference", cascade="all, delete-orphan")
    paper_text = relationship("PaperText", back_populates="reference", uselist=False, cascade="all, delete-orphan")
    qa_responses = relationship("QAResponse", back_populates="reference", cascade="all, delete-orphan")
    term_matches = relationship("TermMatch", back_populates="reference", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_references_title_normalized", "title_normalized"),
        Index("ix_references_year", "year"),
    )
