from sqlalchemy import Column, Integer, String, Float, Text, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class QAResponse(Base):
    __tablename__ = "qa_responses"

    id = Column(Integer, primary_key=True, index=True)
    reference_id = Column(Integer, ForeignKey("references.id", ondelete="CASCADE"), nullable=False, index=True)
    question     = Column(Text, nullable=False)
    answer       = Column(Text, nullable=True)
    model_name   = Column(String(100), nullable=True)
    cost_usd     = Column(Float, nullable=True, default=0.0)
    input_tokens = Column(Integer, nullable=True, default=0)
    output_tokens= Column(Integer, nullable=True, default=0)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    reference = relationship("Reference", back_populates="qa_responses")
