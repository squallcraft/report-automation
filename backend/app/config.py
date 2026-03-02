from typing import List

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./ecourier.db"
    SECRET_KEY: str = "cambiar-en-produccion-super-secreto-2026"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    UPLOAD_DIR: str = "uploads"
    CORS_ORIGINS: List[str] = ["http://localhost:5173"]
    GEMINI_API_KEY: str = ""
    HAULMER_API_KEY: str = ""
    HAULMER_API_URL: str = "https://dev-api.haulmer.com/v2/dte/document"
    # Emisor (tu empresa) para facturación electrónica
    HAULMER_EMISOR_RUT: str = ""
    HAULMER_EMISOR_RAZON: str = ""
    HAULMER_EMISOR_GIRO: str = "Servicios de transporte y logística"
    HAULMER_EMISOR_DIR: str = ""
    HAULMER_EMISOR_CMNA: str = ""
    HAULMER_EMISOR_ACTECO: int = 492110

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
