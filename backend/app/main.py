from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from sqlalchemy import text, inspect
from app.database import engine, Base
from app.api import auth, sellers, drivers, envios, ingesta, liquidacion, productos, comunas, ajustes, consultas, dashboard, retiros, calendario, facturacion, cpc, usuarios, tarifas_escalonadas, diagnostics, portal, chat
from app.middleware.timing import TimingMiddleware

Base.metadata.create_all(bind=engine)

with engine.connect() as conn:
    insp = inspect(engine)
    if "admin_users" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("admin_users")]
        if "rol" not in cols:
            conn.execute(text("ALTER TABLE admin_users ADD COLUMN rol TEXT NOT NULL DEFAULT 'ADMIN'"))
            conn.commit()
    if "drivers" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("drivers")]
        if "contratado" not in cols:
            conn.execute(text("ALTER TABLE drivers ADD COLUMN contratado BOOLEAN NOT NULL DEFAULT FALSE"))
            conn.execute(text(
                "UPDATE drivers SET contratado = TRUE "
                "WHERE lower(nombre) LIKE '%erick%' OR lower(nombre) LIKE '%edwyn%'"
            ))
            conn.commit()
    if "admin_users" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("admin_users")]
        if "permisos" not in cols:
            conn.execute(text("ALTER TABLE admin_users ADD COLUMN permisos JSON"))
            conn.commit()
    if "retiros" in insp.get_table_names() and engine.dialect.name == "postgresql":
        retiro_cols = {c["name"]: c for c in insp.get_columns("retiros")}
        if retiro_cols.get("seller_id", {}).get("nullable") is False:
            conn.execute(text("ALTER TABLE retiros ALTER COLUMN seller_id DROP NOT NULL"))
            conn.commit()
        if retiro_cols.get("driver_id", {}).get("nullable") is False:
            conn.execute(text("ALTER TABLE retiros ALTER COLUMN driver_id DROP NOT NULL"))
            conn.commit()

app = FastAPI(
    title="ECourier — Sistema de Liquidación Logística",
    description="API para gestión de cobros a sellers y pagos a drivers",
    version="1.0.0",
)

settings = get_settings()
app.add_middleware(TimingMiddleware)
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
app.include_router(diagnostics.router, prefix="/api")
app.include_router(portal.router, prefix="/api")
app.include_router(chat.router, prefix="/api")


@app.get("/")
def root():
    return {"message": "ECourier API v1.0", "docs": "/docs"}
