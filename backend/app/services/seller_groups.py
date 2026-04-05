"""
Seller grouping logic for analytics.
Applies to: BI, Efectividad, Retención, Tiers.
Does NOT affect billing, payments, or any operational flow.

Groups: multiple seller accounts treated as one entity in analysis.
  - Ragnar Chile
  - Nuevo Genesis
  - Alca
"""

# fragment (lowercase) → group display name
# Leading space tricks prevent partial-name collisions (e.g. " yan" won't match "Tanya").
SELLER_GROUPS: dict[str, str] = {
    "ragnar chile":                   "Ragnar Chile",
    "nuevo genesis":                  "Nuevo Genesis",
    "comercial element":              "Nuevo Genesis",
    "rebon":                          "Nuevo Genesis",
    " yan":                           "Nuevo Genesis",   # "Comercial Yan" but not "Tanya"
    "sofozy":                         "Nuevo Genesis",
    "equipo alca":                    "Alca",
    "alcaplus":                       "Alca",
    "alca computaci":                 "Alca",
    "sociedad computacional alca":    "Alca",
}


def group_seller(nombre: str) -> str:
    """Returns the analytics group name for a seller, or the original name if ungrouped."""
    if not nombre:
        return nombre or "Sin nombre"
    n_low = " " + nombre.lower()
    for key, group in SELLER_GROUPS.items():
        if key in n_low:
            return group
    return nombre


def is_in_group(nombre: str) -> bool:
    return group_seller(nombre) != nombre


def get_group_map(db) -> dict[int, str]:
    """Returns {seller_id: group_name} for every seller that belongs to an analytics group."""
    from app.models import Seller
    sellers = db.query(Seller.id, Seller.nombre).all()
    result: dict[int, str] = {}
    for s in sellers:
        g = group_seller(s.nombre or "")
        if g != (s.nombre or ""):
            result[s.id] = g
    return result


def get_group_seller_ids(group_name: str, db) -> list[int]:
    """Returns all seller_ids that belong to the given analytics group name."""
    from app.models import Seller
    sellers = db.query(Seller.id, Seller.nombre).all()
    return [s.id for s in sellers if group_seller(s.nombre or "") == group_name]
