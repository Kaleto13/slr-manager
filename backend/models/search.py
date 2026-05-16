from sqlalchemy import Column, Integer, String, Text, DateTime, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Search(Base):
    __tablename__ = "searches"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    database_source = Column(String(100), nullable=True)   # WoS, Scopus, Manual, etc.
    search_date = Column(Date, nullable=True)
    boolean_string = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    search_terms = relationship("SearchTerm", back_populates="search", cascade="all, delete-orphan")
    search_references = relationship("SearchReference", back_populates="search", cascade="all, delete-orphan")
    custom_fields = relationship("CustomField", back_populates="search", cascade="all, delete-orphan")
    screening_decisions = relationship("ScreeningDecision", back_populates="search", cascade="all, delete-orphan")
    prisma_data = relationship("PrismaData", back_populates="search", uselist=False, cascade="all, delete-orphan")
