import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/slr_manager"
)

DEBUG = os.getenv("DEBUG", "False").lower() == "true"
LOCAL_CURRENCY = os.getenv("LOCAL_CURRENCY", "CLP")
EXCHANGE_RATE = float(os.getenv("EXCHANGE_RATE", "850.0"))

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
OA_EMAIL = os.getenv("OA_EMAIL", "")

VITE_API_URL = os.getenv("VITE_API_URL", "http://localhost:8000/api")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL no configurado en .env")

print(f" Config loaded: Currency={LOCAL_CURRENCY}")
