"""
Script de carga inicial: procesa 'configuracion inicial.xlsx' y puebla la base de datos.
Ejecutar: python seed_from_excel.py
"""
import sys
import os

sys.path.insert(0, ".")

import pandas as pd
from collections import defaultdict

from app.database import SessionLocal, engine, Base
from app.models import (
    AdminUser, Seller, Driver, TarifaPlanComuna, EmpresaEnum,
)
from app.auth import hash_password

EXCEL_PATH = os.path.join(os.path.dirname(__file__), "..", "Desktop", "configuracion inicial.xlsx")
if not os.path.exists(EXCEL_PATH):
    EXCEL_PATH = "/Users/oscarguzman/Desktop/configuracion inicial.xlsx"

Base.metadata.create_all(bind=engine)
db = SessionLocal()


def load_sheets():
    xls = pd.ExcelFile(EXCEL_PATH)
    sheets = {}
    for name in xls.sheet_names:
        sheets[name] = pd.read_excel(xls, sheet_name=name)
    return sheets


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


def process_sellers(sheets):
    """
    Hoja1: Homologación (Carga -> Vendedor) = aliases
    Hoja2: Plan tarifario (vendedor -> tarifa = nombre de plan)
    Hoja3: Pago por retiro (vendedor -> monto retiro seller)
    Hoja4: Config general (clientes -> zona, empresa, pickup, pago retiro driver)
    """
    if db.query(Seller).first():
        print("  Sellers ya existen, saltando...")
        return

    hoja1 = sheets.get("Hoja1")
    hoja2 = sheets.get("Hoja2")
    hoja3 = sheets.get("Hoja3")
    hoja4 = sheets.get("Hoja4")

    aliases_map = defaultdict(list)
    if hoja1 is not None:
        col_carga = hoja1.columns[0]
        col_vendedor = hoja1.columns[1]
        for _, row in hoja1.iterrows():
            carga = str(row[col_carga]).strip() if not pd.isna(row[col_carga]) else ""
            vendedor = str(row[col_vendedor]).strip() if not pd.isna(row[col_vendedor]) else ""
            if carga and vendedor:
                if carga.lower() != vendedor.lower():
                    aliases_map[vendedor].append(carga)

    plan_map = {}
    if hoja2 is not None:
        col_v = hoja2.columns[0]
        col_t = hoja2.columns[1]
        for _, row in hoja2.iterrows():
            v = str(row[col_v]).strip() if not pd.isna(row[col_v]) else ""
            t = str(row[col_t]).strip() if not pd.isna(row[col_t]) else ""
            if v and t:
                plan_map[v] = t

    retiro_map = {}
    if hoja3 is not None:
        col_v = hoja3.columns[0]
        col_r = hoja3.columns[1]
        for _, row in hoja3.iterrows():
            v = str(row[col_v]).strip() if not pd.isna(row[col_v]) else ""
            r = row[col_r] if not pd.isna(row[col_r]) else 0
            if v:
                retiro_map[v] = int(r) if r else 0

    config_map = {}
    if hoja4 is not None:
        cols = hoja4.columns.tolist()
        for _, row in hoja4.iterrows():
            nombre = str(row[cols[0]]).strip() if not pd.isna(row[cols[0]]) else ""
            if not nombre:
                continue
            zona = str(row[cols[1]]).strip() if len(cols) > 1 and not pd.isna(row[cols[1]]) else "Santiago"
            empresa_raw = str(row[cols[2]]).strip().upper() if len(cols) > 2 and not pd.isna(row[cols[2]]) else "ECOURIER"
            pickup_raw = str(row[cols[3]]).strip().upper() if len(cols) > 3 and not pd.isna(row[cols[3]]) else "NO"
            retiro_driver = int(row[cols[4]]) if len(cols) > 4 and not pd.isna(row[cols[4]]) else 0

            empresa = EmpresaEnum.ECOURIER.value
            if "OVIEDO" in empresa_raw:
                empresa = EmpresaEnum.OVIEDO.value
            elif "TERCER" in empresa_raw:
                empresa = EmpresaEnum.TERCERIZADO.value

            config_map[nombre] = {
                "zona": zona,
                "empresa": empresa,
                "usa_pickup": pickup_raw == "SI",
                "tarifa_retiro_driver": retiro_driver,
            }

    all_names = set()
    all_names.update(aliases_map.keys())
    all_names.update(plan_map.keys())
    all_names.update(retiro_map.keys())
    all_names.update(config_map.keys())

    count = 0
    for nombre in sorted(all_names):
        aliases = list(set(aliases_map.get(nombre, [])))
        plan = plan_map.get(nombre)
        retiro_seller = retiro_map.get(nombre, 0)
        cfg = config_map.get(nombre, {})

        tiene_retiro = retiro_seller > 0
        min_paquetes = 6 if tiene_retiro else 0
        usa_pickup = cfg.get("usa_pickup", False)
        if usa_pickup:
            tiene_retiro = False
            retiro_seller = 0
            min_paquetes = 0

        seller = Seller(
            nombre=nombre,
            aliases=aliases,
            zona=cfg.get("zona", "Santiago"),
            empresa=cfg.get("empresa", EmpresaEnum.ECOURIER.value),
            precio_base=0,
            plan_tarifario=plan,
            tiene_retiro=tiene_retiro,
            tarifa_retiro=retiro_seller,
            tarifa_retiro_driver=cfg.get("tarifa_retiro_driver", 0),
            min_paquetes_retiro_gratis=min_paquetes,
            usa_pickup=usa_pickup,
        )
        db.add(seller)
        count += 1

    db.commit()
    print(f"  {count} sellers creados desde Excel")


def process_tariff_matrix(sheets):
    """
    Hoja5: Matriz de tarifas (comuna x plan_tarifario -> precio)
    """
    if db.query(TarifaPlanComuna).first():
        print("  Matriz tarifaria ya existe, saltando...")
        return

    hoja5 = sheets.get("Hoja5")
    if hoja5 is None:
        print("  Hoja5 no encontrada, saltando matriz tarifaria")
        return

    cols = hoja5.columns.tolist()
    comuna_col = cols[0]
    plan_cols = cols[1:]

    seen = set()
    count = 0
    for _, row in hoja5.iterrows():
        comuna = str(row[comuna_col]).strip() if not pd.isna(row[comuna_col]) else ""
        if not comuna:
            continue

        for plan_col in plan_cols:
            plan_name = str(plan_col).strip()
            precio_raw = row[plan_col]
            if pd.isna(precio_raw):
                continue
            try:
                precio = int(float(precio_raw))
            except (ValueError, TypeError):
                continue
            if precio <= 0:
                continue

            key = (plan_name.lower(), comuna.lower())
            if key in seen:
                continue
            seen.add(key)

            db.add(TarifaPlanComuna(
                plan_tarifario=plan_name,
                comuna=comuna.lower(),
                precio=precio,
            ))
            count += 1

    db.commit()
    print(f"  {count} entradas en matriz tarifaria creadas")


if __name__ == "__main__":
    print(f"Procesando: {EXCEL_PATH}")
    if not os.path.exists(EXCEL_PATH):
        print(f"ERROR: No se encontró el archivo {EXCEL_PATH}")
        sys.exit(1)

    sheets = load_sheets()
    print(f"Hojas encontradas: {list(sheets.keys())}")
    for name, df in sheets.items():
        print(f"  {name}: {len(df)} filas, columnas: {list(df.columns)}")
    print()

    print("[1/3] Admin...")
    seed_admin()

    print("[2/3] Sellers...")
    process_sellers(sheets)

    print("[3/3] Matriz tarifaria...")
    process_tariff_matrix(sheets)

    print()
    print("Carga inicial completada.")
    db.close()
