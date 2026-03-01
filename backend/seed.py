"""
Script de seed: carga datos iniciales de referencia en la base de datos.
Ejecutar: python seed.py
"""
import sys
sys.path.insert(0, ".")

from app.database import SessionLocal, engine, Base
from app.models import (
    AdminUser, Seller, Driver, ProductoConExtra, TarifaComuna, EmpresaEnum,
)
from app.auth import hash_password

Base.metadata.create_all(bind=engine)
db = SessionLocal()


def seed_admin():
    if db.query(AdminUser).first():
        print("  Admin ya existe, saltando...")
        return
    admin = AdminUser(
        username="admin",
        password_hash=hash_password("admin123"),
        nombre="Administrador",
    )
    db.add(admin)
    db.commit()
    print("  Admin creado: admin / admin123")


def seed_sellers():
    if db.query(Seller).first():
        print("  Sellers ya existen, saltando...")
        return

    sellers_data = [
        {"nombre": "MercadoLibre Chile", "aliases": ["Mercado Libre", "ML Chile", "MeLi"], "empresa": EmpresaEnum.ECOURIER, "precio_base": 2500, "factura_iva": True, "zona": "Santiago"},
        {"nombre": "Falabella", "aliases": ["Falabella.com", "FALABELLA"], "empresa": EmpresaEnum.ECOURIER, "precio_base": 2800, "factura_iva": True, "zona": "Santiago"},
        {"nombre": "Ripley", "aliases": ["Ripley.com", "RIPLEY"], "empresa": EmpresaEnum.ECOURIER, "precio_base": 2800, "factura_iva": True, "zona": "Santiago"},
        {"nombre": "Paris", "aliases": ["Paris.cl", "PARIS"], "empresa": EmpresaEnum.ECOURIER, "precio_base": 2600, "factura_iva": True, "zona": "Santiago"},
        {"nombre": "Ferretería Oviedo", "aliases": ["Oviedo", "FERRETERIA OVIEDO", "Ferr. Oviedo"], "empresa": EmpresaEnum.OVIEDO, "precio_base": 2200, "factura_iva": True, "zona": "Santiago"},
        {"nombre": "Aventura Store", "aliases": ["AVENTURA STORE", "Aventura"], "empresa": EmpresaEnum.TERCERIZADO, "precio_base": 2000, "factura_iva": False, "zona": "Santiago"},
        {"nombre": "BARFOOD", "aliases": ["Barfood", "BAR FOOD"], "empresa": EmpresaEnum.TERCERIZADO, "precio_base": 1800, "factura_iva": False, "zona": "Santiago"},
        {"nombre": "Millenium", "aliases": ["MILLENIUM", "Millennium"], "empresa": EmpresaEnum.TERCERIZADO, "precio_base": 2300, "factura_iva": False, "zona": "Santiago"},
        {"nombre": "Relámpagos", "aliases": ["RELAMPAGOS", "Relampagos"], "empresa": EmpresaEnum.TERCERIZADO, "precio_base": 2300, "factura_iva": False, "zona": "Santiago"},
        {"nombre": "TiendaOnline CL", "aliases": ["TiendaOnline", "TIENDA ONLINE"], "empresa": EmpresaEnum.ECOURIER, "precio_base": 2400, "factura_iva": True, "zona": "Valparaíso"},
    ]

    for s in sellers_data:
        seller = Seller(
            email=f"{s['nombre'].lower().replace(' ', '').replace('í','i')}@ecourier.cl",
            password_hash=hash_password("seller123"),
            **s,
        )
        db.add(seller)

    db.commit()
    print(f"  {len(sellers_data)} sellers creados")


def seed_drivers():
    if db.query(Driver).first():
        print("  Drivers ya existen, saltando...")
        return

    drivers_data = [
        {"nombre": "Carlos", "aliases": ["Carlos Pérez", "Carlos Perez (auto-create)"], "tarifa_ecourier": 1700, "tarifa_oviedo": 1800, "tarifa_tercerizado": 1500},
        {"nombre": "Miguel", "aliases": ["Miguel López", "Miguel Lopez (auto-create)"], "tarifa_ecourier": 1700, "tarifa_oviedo": 1800, "tarifa_tercerizado": 1500},
        {"nombre": "Fernando", "aliases": ["Fernando Rojas", "Fernando R."], "tarifa_ecourier": 1700, "tarifa_oviedo": 1800, "tarifa_tercerizado": 1500},
        {"nombre": "Augusto", "aliases": ["Augusto Silva", "AUGUSTO"], "tarifa_ecourier": 1900, "tarifa_oviedo": 1800, "tarifa_tercerizado": 1500},
        {"nombre": "Guillermo", "aliases": ["Guillermo Torres"], "tarifa_ecourier": 1900, "tarifa_oviedo": 1800, "tarifa_tercerizado": 1500},
        {"nombre": "Javiera", "aliases": ["Javiera Muñoz", "Javiera M."], "tarifa_ecourier": 1900, "tarifa_oviedo": 1800, "tarifa_tercerizado": 1500},
        {"nombre": "Sinndy", "aliases": ["Sinndy Contreras", "SINNDY"], "tarifa_ecourier": 1900, "tarifa_oviedo": 1800, "tarifa_tercerizado": 1500},
        {"nombre": "Jorge", "aliases": ["Jorge Díaz", "Jorge Diaz"], "tarifa_ecourier": 2000, "tarifa_oviedo": 1800, "tarifa_tercerizado": 1500},
        {"nombre": "Leonardo", "aliases": ["Leonardo Vargas", "Leo"], "tarifa_ecourier": 2000, "tarifa_oviedo": 1800, "tarifa_tercerizado": 1500},
        {"nombre": "Jcargo Macul", "aliases": ["JCARGO MACUL", "Jcargo"], "tarifa_ecourier": 2200, "tarifa_oviedo": 1800, "tarifa_tercerizado": 1500},
        {"nombre": "Martin", "aliases": ["Martin Soto", "MARTIN"], "tarifa_ecourier": 2200, "tarifa_oviedo": 1700, "tarifa_tercerizado": 1500},
        {"nombre": "Wilmer", "aliases": ["Wilmer Araya", "WILMER"], "tarifa_ecourier": 2200, "tarifa_oviedo": 1800, "tarifa_tercerizado": 1500},
        {"nombre": "Erick", "aliases": ["Erick Guzmán", "ERICK"], "tarifa_ecourier": 500, "tarifa_oviedo": 500, "tarifa_tercerizado": 500},
        {"nombre": "Edwyn Matheus", "aliases": ["EDWYN MATHEUS", "Edwyn"], "tarifa_ecourier": 500, "tarifa_oviedo": 500, "tarifa_tercerizado": 500},
        {"nombre": "Jakcy", "aliases": ["Jakcy Carvallo Moreno (auto-create)", "Jakcy Carvallo", "JAKCY"], "tarifa_ecourier": 500, "tarifa_oviedo": 500, "tarifa_tercerizado": 500},
    ]

    for d in drivers_data:
        driver = Driver(
            email=f"{d['nombre'].lower().replace(' ', '')}@ecourier.cl",
            password_hash=hash_password("driver123"),
            **d,
        )
        db.add(driver)

    db.commit()
    print(f"  {len(drivers_data)} drivers creados")


def seed_productos_extra():
    if db.query(ProductoConExtra).first():
        print("  Productos ya existen, saltando...")
        return

    productos = [
        {"codigo_mlc": "MLC1774402962", "descripcion": "Producto voluminoso tipo A", "extra_seller": 2200, "extra_driver": 1000},
        {"codigo_mlc": "MLC2220238846", "descripcion": "Crema Reductora especial", "extra_seller": 2200, "extra_driver": 1000},
        {"codigo_mlc": "MLC1850003921", "descripcion": "Electrodoméstico grande", "extra_seller": 3000, "extra_driver": 1500},
        {"codigo_mlc": "MLC1990045678", "descripcion": "Producto frágil premium", "extra_seller": 2500, "extra_driver": 1200},
        {"codigo_mlc": "MLC2100078901", "descripcion": "Caja extra grande", "extra_seller": 2200, "extra_driver": 1000},
    ]

    for p in productos:
        db.add(ProductoConExtra(**p))

    db.commit()
    print(f"  {len(productos)} productos con extra creados")


def seed_tarifas_comuna():
    if db.query(TarifaComuna).first():
        print("  Tarifas comuna ya existen, saltando...")
        return

    comunas = [
        {"comuna": "padre hurtado", "extra_seller": 500, "extra_driver": 300},
        {"comuna": "buin", "extra_seller": 0, "extra_driver": 0},
        {"comuna": "santiago", "extra_seller": 0, "extra_driver": 0},
        {"comuna": "providencia", "extra_seller": 0, "extra_driver": 0},
        {"comuna": "las condes", "extra_seller": 0, "extra_driver": 0},
        {"comuna": "maipu", "extra_seller": 0, "extra_driver": 0},
        {"comuna": "la florida", "extra_seller": 0, "extra_driver": 0},
        {"comuna": "puente alto", "extra_seller": 0, "extra_driver": 0},
        {"comuna": "valparaiso", "extra_seller": 0, "extra_driver": 0},
        {"comuna": "viña del mar", "extra_seller": 0, "extra_driver": 0},
    ]

    for c in comunas:
        db.add(TarifaComuna(**c))

    db.commit()
    print(f"  {len(comunas)} tarifas de comuna creadas")


if __name__ == "__main__":
    print("Ejecutando seed de ECourier...")
    print()
    print("[1/5] Admin...")
    seed_admin()
    print("[2/5] Sellers...")
    seed_sellers()
    print("[3/5] Drivers...")
    seed_drivers()
    print("[4/5] Productos con extra...")
    seed_productos_extra()
    print("[5/5] Tarifas por comuna...")
    seed_tarifas_comuna()
    print()
    print("Seed completado exitosamente.")
    db.close()
