from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class CustomField(Base):
    __tablename__ = "custom_fields"

    id = Column(Integer, primary_key=True, index=True)
    search_id = Column(Integer, ForeignKey("searches.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    field_type = Column(String(50), default="text")   # text, number, boolean, select, multiselect
    options = Column(Text, nullable=True)              # JSON array de opciones para select/multiselect
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    search = relationship("Search", back_populates="custom_fields")
    field_values = relationship("FieldValue", back_populates="custom_field", cascade="all, delete-orphan")
