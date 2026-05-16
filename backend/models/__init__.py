# Importar todos los modelos para que SQLAlchemy los registre en Base.metadata
from models.reference import Reference
from models.search import Search
from models.search_term import SearchTerm
from models.search_reference import SearchReference
from models.custom_field import CustomField
from models.field_value import FieldValue
from models.screening import ScreeningCriteria, ScreeningDecision
from models.annotation import Annotation
from models.paper_text import PaperText
from models.token_usage import TokenUsage
from models.change_log import ChangeLog
from models.qa_response import QAResponse
from models.term_match import TermMatch
from models.prisma_data import PrismaData
from models.duplicate import Duplicate

__all__ = [
    "Reference",
    "Search",
    "SearchTerm",
    "SearchReference",
    "CustomField",
    "FieldValue",
    "ScreeningCriteria",
    "ScreeningDecision",
    "Annotation",
    "PaperText",
    "TokenUsage",
    "ChangeLog",
    "QAResponse",
    "TermMatch",
    "PrismaData",
    "Duplicate",
]
