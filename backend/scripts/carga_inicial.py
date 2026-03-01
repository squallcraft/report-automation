"""
Script de carga inicial desde 'configuracion inicial.xlsx'.
Procesa 6 hojas: homologación, tarifas, retiros, config general, planes comuna, mensual.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pandas as pd
from sqlalchemy import text
from app.database import engine, SessionLocal, Base
from app.models import Seller, TarifaPlanComuna, TarifaComuna

EXCEL_PATH = "/Users/oscarguzman/Desktop/configuracion inicial.xlsx"
MIN_PAQUETES_DEFAULT = 6


def add_column_if_missing(conn, table, column, col_type, default):
    try:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type} DEFAULT {default}"))
        print(f"  Columna '{column}' agregada a '{table}'")
    except Exception:
        pass


def get_or_create_seller(db, nombre):
    seller = db.query(Seller).filter(
        Seller.nombre.ilike(nombre.strip())
    ).first()
    if not seller:
        seller = Seller(nombre=nombre.strip())
        db.add(seller)
        db.flush()
    return seller


def process_hoja1_homologacion(db, xls):
    """Hoja1: Carga (raw) → Vendedor (final). Crea sellers y agrega aliases."""
    print("\n── Hoja1: Homologación ──")
    df = pd.read_excel(xls, sheet_name="Hoja1")
    sellers_created = 0
    aliases_added = 0

    grouped = df.groupby("Vendedor")["Carga"].apply(list).to_dict()

    for vendedor, raws in grouped.items():
        vendedor = str(vendedor).strip()
        if not vendedor or vendedor == "nan":
            continue

        seller = get_or_create_seller(db, vendedor)
        if seller.id is None:
            db.flush()
            sellers_created += 1

        current = [a.lower() for a in (seller.aliases or [])]
        new_aliases = list(seller.aliases or [])
        for raw in raws:
            raw = str(raw).strip()
            if not raw or raw == "nan":
                continue
            if raw.lower() not in current and raw.lower() != vendedor.lower():
                new_aliases.append(raw)
                current.append(raw.lower())
                aliases_added += 1

        seller.aliases = new_aliases

    db.flush()
    print(f"  Sellers creados: {sellers_created}")
    print(f"  Aliases agregados: {aliases_added}")


def process_hoja2_tarifas(db, xls):
    """Hoja2: vendedor + tarifa. Número → precio_base. Texto → plan_tarifario."""
    print("\n── Hoja2: Tarifas ──")
    df = pd.read_excel(xls, sheet_name="Hoja2")
    precio_set = 0
    plan_set = 0
    not_found = []

    for _, row in df.iterrows():
        nombre = str(row.get("vendedor", "")).strip()
        tarifa = row.get("tarifa")
        if not nombre or nombre == "nan":
            continue

        seller = db.query(Seller).filter(Seller.nombre.ilike(nombre)).first()
        if not seller:
            not_found.append(nombre)
            continue

        try:
            val = int(float(tarifa))
            seller.precio_base = val
            seller.plan_tarifario = None
            precio_set += 1
        except (ValueError, TypeError):
            plan_name = str(tarifa).strip()
            seller.plan_tarifario = plan_name
            seller.precio_base = 0
            plan_set += 1

    db.flush()
    print(f"  Precio base fijo: {precio_set}")
    print(f"  Plan tarifario asignado: {plan_set}")
    if not_found:
        print(f"  Sellers no encontrados ({len(not_found)}): {not_found[:10]}...")


def process_hoja3_retiro(db, xls):
    """Hoja3: vendedor + Pago por retiro."""
    print("\n── Hoja3: Pago por retiro ──")
    df = pd.read_excel(xls, sheet_name="Hoja3")
    updated = 0
    con_retiro = 0
    not_found = []

    for _, row in df.iterrows():
        nombre = str(row.get("vendedor", "")).strip()
        pago = row.get("Pago por retiro", 0)
        if not nombre or nombre == "nan":
            continue

        seller = db.query(Seller).filter(Seller.nombre.ilike(nombre)).first()
        if not seller:
            not_found.append(nombre)
            continue

        try:
            pago_val = int(float(pago))
        except (ValueError, TypeError):
            pago_val = 0

        seller.tarifa_retiro = pago_val
        if pago_val > 0:
            seller.tiene_retiro = True
            seller.min_paquetes_retiro_gratis = MIN_PAQUETES_DEFAULT
            con_retiro += 1
        updated += 1

    db.flush()
    print(f"  Sellers actualizados: {updated}")
    print(f"  Con retiro (tarifa > 0): {con_retiro}")
    if not_found:
        print(f"  No encontrados ({len(not_found)}): {not_found[:10]}...")


def process_hoja4_config(db, xls):
    """Hoja4: clientes + zona + EMPRESA + PICKUP + Pago por retiro a driver."""
    print("\n── Hoja4: Config general ──")
    df = pd.read_excel(xls, sheet_name="Hoja4")
    updated = 0
    not_found = []

    for _, row in df.iterrows():
        nombre = str(row.get("clientes", "")).strip()
        if not nombre or nombre == "nan":
            continue

        seller = db.query(Seller).filter(Seller.nombre.ilike(nombre)).first()
        if not seller:
            not_found.append(nombre)
            continue

        zona = str(row.get("zona", "Santiago")).strip()
        empresa = str(row.get("EMPRESA", "ECOURIER")).strip().upper()
        pickup = str(row.get("PICKUP", "NO")).strip().upper()
        pago_driver = row.get("Pago por retiro a driver", 0)

        seller.zona = zona
        seller.empresa = empresa
        seller.usa_pickup = (pickup == "SI")

        try:
            seller.tarifa_retiro_driver = int(float(pago_driver))
        except (ValueError, TypeError):
            seller.tarifa_retiro_driver = 0

        updated += 1

    db.flush()
    print(f"  Sellers actualizados: {updated}")
    if not_found:
        print(f"  No encontrados ({len(not_found)}): {not_found[:10]}...")


def process_hoja5_planes(db, xls):
    """Hoja5: matriz comunas × planes tarifarios → TarifaPlanComuna."""
    print("\n── Hoja5: Planes tarifarios por comuna ──")
    df = pd.read_excel(xls, sheet_name="Hoja5")

    plan_cols = [c for c in df.columns if c != "comuna"]
    inserted = 0
    skipped = 0
    seen = set()

    for _, row in df.iterrows():
        comuna = str(row.get("comuna", "")).strip()
        if not comuna or comuna == "nan":
            continue

        comuna_key = comuna.lower()

        for plan_col in plan_cols:
            plan_name = str(plan_col).strip()
            precio = row.get(plan_col)

            pair = (plan_name.lower(), comuna_key)
            if pair in seen:
                skipped += 1
                continue

            if pd.isna(precio):
                skipped += 1
                continue

            try:
                precio_val = int(float(precio))
            except (ValueError, TypeError):
                skipped += 1
                continue

            seen.add(pair)

            existing = db.query(TarifaPlanComuna).filter(
                TarifaPlanComuna.plan_tarifario == plan_name,
                TarifaPlanComuna.comuna == comuna,
            ).first()
            if existing:
                existing.precio = precio_val
            else:
                db.add(TarifaPlanComuna(
                    plan_tarifario=plan_name,
                    comuna=comuna,
                    precio=precio_val,
                ))
            inserted += 1

    db.flush()
    print(f"  Registros insertados/actualizados: {inserted}")
    print(f"  Celdas vacías/duplicadas saltadas: {skipped}")
    print(f"  Comunas en archivo: {len(df)}, Planes: {len(plan_cols)}")


def process_hoja6_mensual(db, xls):
    """Hoja6: vendedor + mensual."""
    print("\n── Hoja6: Pago mensual ──")
    df = pd.read_excel(xls, sheet_name="Hoja6")
    updated = 0
    not_found = []

    for _, row in df.iterrows():
        nombre = str(row.get("vendedor", "")).strip()
        mensual = str(row.get("mensual", "")).strip().upper()
        if not nombre or nombre == "nan":
            continue

        seller = db.query(Seller).filter(Seller.nombre.ilike(nombre)).first()
        if not seller:
            not_found.append(nombre)
            continue

        seller.mensual = (mensual == "SI")
        updated += 1

    db.flush()
    print(f"  Sellers marcados como mensual: {updated}")
    if not_found:
        print(f"  No encontrados ({len(not_found)}): {not_found[:10]}...")


def main():
    print("=" * 60)
    print("CARGA INICIAL DE CONFIGURACIÓN")
    print("=" * 60)

    with engine.connect() as conn:
        add_column_if_missing(conn, "sellers", "mensual", "BOOLEAN", "0")
        conn.commit()

    Base.metadata.create_all(bind=engine)

    xls = pd.ExcelFile(EXCEL_PATH)
    print(f"Archivo: {EXCEL_PATH}")
    print(f"Hojas: {xls.sheet_names}")

    db = SessionLocal()
    try:
        process_hoja1_homologacion(db, xls)
        process_hoja2_tarifas(db, xls)
        process_hoja3_retiro(db, xls)
        process_hoja4_config(db, xls)
        process_hoja5_planes(db, xls)
        process_hoja6_mensual(db, xls)

        db.commit()
        print("\n" + "=" * 60)
        print("CARGA COMPLETADA EXITOSAMENTE")
        print("=" * 60)

        total_sellers = db.query(Seller).count()
        activos = db.query(Seller).filter(Seller.activo == True).count()
        planes = db.query(TarifaPlanComuna).count()
        print(f"\nResumen final:")
        print(f"  Total sellers: {total_sellers}")
        print(f"  Sellers activos: {activos}")
        print(f"  Registros TarifaPlanComuna: {planes}")

    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
