from sqlalchemy import Column, Integer, Text, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class PaperText(Base):
    __tablename__ = "paper_texts"

    id = Column(Integer, primary_key=True, index=True)
    reference_id = Column(Integer, ForeignKey("references.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    plain_text = Column(Text, nullable=True)       # Texto plano extraído del PDF
    markdown_text = Column(Text, nullable=True)    # Versión markdown
    char_count = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    reference = relationship("Reference", back_populates="paper_text")
