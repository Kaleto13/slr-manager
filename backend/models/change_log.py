from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from database import Base


class ChangeLog(Base):
    __tablename__ = "change_log"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String(100), nullable=False, index=True)   # import, delete, update, screen, etc.
    entity = Column(String(100), nullable=True)                # references, searches, etc.
    entity_id = Column(Integer, nullable=True, index=True)
    detail = Column(Text, nullable=True)                       # JSON o texto libre
    created_at = Column(DateTime(timezone=True), server_default=func.now())
