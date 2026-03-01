from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from sqlalchemy import text, inspect
from app.database import engine, Base
from app.api import auth, sellers, drivers, envios, ingesta, liquidacion, productos, comunas, ajustes, consultas, dashboard, retiros, calendario, facturacion, cpc, usuarios, tarifas_escalonadas

Base.metadata.create_all(bind=engine)

with engine.connect() as conn:
    insp = inspect(engine)
    if "admin_users" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("admin_users")]
        if "rol" not in cols:
            conn.execute(text("ALTER TABLE admin_users ADD COLUMN rol TEXT NOT NULL DEFAULT 'ADMIN'"))
            conn.commit()

app = FastAPI(
    title="ECourier — Sistema de Liquidación Logística",
    description="API para gestión de cobros a sellers y pagos a drivers",
    version="1.0.0",
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(sellers.router, prefix="/api")
app.include_router(drivers.router, prefix="/api")
app.include_router(envios.router, prefix="/api")
app.include_router(ingesta.router, prefix="/api")
app.include_router(liquidacion.router, prefix="/api")
app.include_router(productos.router, prefix="/api")
app.include_router(comunas.router, prefix="/api")
app.include_router(ajustes.router, prefix="/api")
app.include_router(retiros.router, prefix="/api")
app.include_router(consultas.router, prefix="/api")
app.include_router(calendario.router, prefix="/api")
app.include_router(facturacion.router, prefix="/api")
app.include_router(cpc.router, prefix="/api")
app.include_router(usuarios.router, prefix="/api")
app.include_router(tarifas_escalonadas.router, prefix="/api")


@app.get("/")
def root():
    return {"message": "ECourier API v1.0", "docs": "/docs"}
