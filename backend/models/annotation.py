from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Annotation(Base):
    __tablename__ = "annotations"

    id = Column(Integer, primary_key=True, index=True)
    reference_id = Column(Integer, ForeignKey("references.id", ondelete="CASCADE"), nullable=False, index=True)
    page = Column(Integer, nullable=True)
    text = Column(Text, nullable=True)       # Texto subrayado
    comment = Column(Text, nullable=True)    # Comentario del usuario (obligatorio si hay texto)
    tag = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    reference = relationship("Reference", back_populates="annotations")
