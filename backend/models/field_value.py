from sqlalchemy import Column, Integer, Text, ForeignKey, DateTime, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class FieldValue(Base):
    __tablename__ = "field_values"

    id = Column(Integer, primary_key=True, index=True)
    reference_id = Column(Integer, ForeignKey("references.id", ondelete="CASCADE"), nullable=False)
    custom_field_id = Column(Integer, ForeignKey("custom_fields.id", ondelete="CASCADE"), nullable=False)
    value = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    reference = relationship("Reference", back_populates="field_values")
    custom_field = relationship("CustomField", back_populates="field_values")

    __table_args__ = (
        Index("ix_field_values_ref_field", "reference_id", "custom_field_id", unique=True),
    )
