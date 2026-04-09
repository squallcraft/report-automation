#!/bin/bash
set -e

# ─────────────────────────────────────────────────
# ECourier — Script de deploy para DigitalOcean
# Droplet: 159.65.248.113
# Dominio: facturacion.e-courier.cl
# ─────────────────────────────────────────────────

DOMAIN="facturacion.e-courier.cl"
EMAIL="oscar@e-courier.cl"  # Cambiar al email real para Let's Encrypt
APP_DIR="/opt/ecourier"

echo "=== ECourier Deploy ==="
echo ""

# ── 1. Instalar Docker si no está ──
if ! command -v docker &> /dev/null; then
    echo "[1/7] Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    echo "[1/7] Docker ya instalado"
fi

# ── 2. Clonar o actualizar repo ──
if [ -d "$APP_DIR" ]; then
    echo "[2/7] Actualizando código..."
    cd "$APP_DIR"
    git pull origin main
else
    echo "[2/7] Clonando repositorio..."
    git clone https://github.com/squallcraft/report-automation.git "$APP_DIR"
    cd "$APP_DIR"
fi

# ── 3. Configurar variables de entorno ──
if [ ! -f .env ]; then
    echo "[3/7] Creando .env de producción..."
    SECRET=$(openssl rand -hex 32)
    PG_PASS=$(openssl rand -hex 16)
    cat > .env <<EOF
POSTGRES_USER=ecourier
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=ecourier
SECRET_KEY=${SECRET}
ACCESS_TOKEN_EXPIRE_MINUTES=480
EOF
    echo "  .env creado con passwords aleatorios"
else
    echo "[3/7] .env ya existe, no se modifica"
fi

# ── 4. Arrancar con nginx sin SSL (para obtener certificado) ──
echo "[4/7] Primer arranque (HTTP only para validar dominio)..."
cp frontend/nginx.init.conf frontend/nginx.conf.bak
cp frontend/nginx.init.conf frontend/nginx.conf
docker compose up -d --build db backend frontend

echo "  Esperando que los servicios arranquen..."
sleep 10

# ── 5. Obtener certificado SSL ──
echo "[5/7] Obteniendo certificado SSL para ${DOMAIN}..."
docker compose run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

# ── 6. Activar nginx con SSL ──
echo "[6/7] Activando HTTPS..."
# Restaurar el nginx.conf con SSL
git checkout frontend/nginx.conf
docker compose up -d --build frontend certbot

echo "[7/7] Verificando servicios..."
sleep 5
docker compose ps

echo ""
echo "════════════════════════════════════════════"
echo "  Deploy completado"
echo "  https://${DOMAIN}"
echo "════════════════════════════════════════════"
echo ""
echo "Siguiente paso: migrar datos desde SQLite"
echo "  scp backend/ecourier.db root@159.65.248.113:/tmp/"
echo "  ssh root@159.65.248.113"
echo "  cd /opt/ecourier"
echo "  docker compose exec backend pip install psycopg2-binary"
echo "  # Ejecutar migración dentro del container"
