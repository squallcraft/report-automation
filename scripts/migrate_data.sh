#!/bin/bash
set -e

# ─────────────────────────────────────────────────
# Migra datos de SQLite → PostgreSQL en producción
#
# Ejecutar desde tu máquina local:
#   ./scripts/migrate_data.sh
#
# Prerequisitos:
#   - El droplet ya tiene el sistema corriendo
#   - Tienes el archivo ecourier.db en backend/
# ─────────────────────────────────────────────────

SERVER="root@165.22.144.142"
APP_DIR="/opt/ecourier"
SQLITE_FILE="backend/ecourier.db"

if [ ! -f "$SQLITE_FILE" ]; then
    echo "Error: No se encontró $SQLITE_FILE"
    echo "Ejecuta este script desde la raíz del proyecto ecourier/"
    exit 1
fi

echo "=== Migración SQLite → PostgreSQL ==="
echo ""

echo "[1/4] Subiendo ecourier.db al servidor..."
scp "$SQLITE_FILE" "${SERVER}:/tmp/ecourier.db"

echo "[2/4] Copiando DB al container backend..."
ssh "$SERVER" "docker cp /tmp/ecourier.db \$(docker compose -f ${APP_DIR}/docker-compose.yml ps -q backend):/app/ecourier.db"

echo "[3/4] Copiando script de migración al container..."
scp scripts/migrate_sqlite_to_postgres.py "${SERVER}:/tmp/migrate.py"
ssh "$SERVER" "docker cp /tmp/migrate.py \$(docker compose -f ${APP_DIR}/docker-compose.yml ps -q backend):/app/migrate.py"

echo "[4/4] Ejecutando migración..."
ssh "$SERVER" "docker compose -f ${APP_DIR}/docker-compose.yml exec backend python /app/migrate.py"

echo ""
echo "════════════════════════════════════════════"
echo "  Migración completada"
echo "  Todos los datos están en PostgreSQL"
echo "════════════════════════════════════════════"
