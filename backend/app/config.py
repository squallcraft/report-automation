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
    GROK_API_KEY: str = ""
    XAI_API_KEY: str = ""
    HAULMER_API_KEY: str = ""
    HAULMER_API_URL: str = "https://api.haulmer.com/v2/dte/document"
    HAULMER_EMISOR_RUT: str = ""
    HAULMER_EMISOR_RAZON: str = ""
    HAULMER_EMISOR_GIRO: str = "Servicios de transporte y logística"
    HAULMER_EMISOR_DIR: str = "MONEDA 1137 56"
    HAULMER_EMISOR_CMNA: str = "SANTIAGO"
    HAULMER_EMISOR_ACTECO: int = 532000
    # Reset de contraseña (SMTP genérico)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    FRONTEND_URL: str = "http://localhost:5173"
    # Amazon SES — campañas de email masivo
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_SES_REGION: str = "us-east-1"
    SES_FROM_EMAIL: str = ""        # ej: "contacto@ecourier.cl"
    SES_FROM_NAME: str = "ECourier" # nombre que aparece en el remitente
    BACKEND_URL: str = "https://api.ecourier.cl"  # para tracking pixel
    # TrackingTech (escaneos pickup)
    TRACKINGTECH_API_URL: str = "https://api-app.trackingtech.cl/api"
    TRACKINGTECH_EMAIL: str = ""
    TRACKINGTECH_PASSWORD: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
