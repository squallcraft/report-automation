#!/bin/bash
# ─────────────────────────────────────────
# Backup diario de PostgreSQL
# Agregar a crontab del servidor:
#   0 3 * * * /opt/ecourier/scripts/backup.sh
# ─────────────────────────────────────────

BACKUP_DIR="/opt/ecourier/backups"
MAX_DAYS=30
DATE=$(date +%Y%m%d_%H%M)

mkdir -p "$BACKUP_DIR"

docker compose -f /opt/ecourier/docker-compose.yml exec -T db \
    pg_dump -U ecourier ecourier | gzip > "${BACKUP_DIR}/ecourier_${DATE}.sql.gz"

find "$BACKUP_DIR" -name "*.sql.gz" -mtime +${MAX_DAYS} -delete

echo "Backup completado: ecourier_${DATE}.sql.gz"
