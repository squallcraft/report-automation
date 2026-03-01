# ECourier — Sistema de Liquidación Logística

Sistema web para automatizar la liquidación de cobros a sellers y pagos a drivers de ECourier.

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Python 3.12 + FastAPI |
| Base de datos | PostgreSQL 16 |
| Frontend | React 18 + Vite + TailwindCSS |
| PDFs | ReportLab |
| Autenticación | JWT (python-jose + passlib) |

## Inicio Rápido

### 1. Base de datos

```bash
docker compose up -d
```

Esto levanta PostgreSQL en `localhost:5432` con usuario `ecourier` / contraseña `ecourier`.

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Copiar configuración
cp .env.example .env

# Cargar datos iniciales
python seed.py

# Iniciar servidor
uvicorn app.main:app --reload --port 8000
```

La API estará disponible en `http://localhost:8000`. Documentación interactiva en `http://localhost:8000/docs`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

La aplicación estará en `http://localhost:5173`.

## Credenciales por Defecto

| Rol | Usuario | Contraseña |
|-----|---------|-----------|
| Admin | `admin` | `admin123` |
| Seller | `mercadolibrechile@ecourier.cl` | `seller123` |
| Driver | `carlos@ecourier.cl` | `driver123` |

## Estructura del Proyecto

```
ecourier/
├── backend/
│   ├── app/
│   │   ├── main.py              # Punto de entrada FastAPI
│   │   ├── config.py            # Configuración desde .env
│   │   ├── database.py          # Conexión SQLAlchemy
│   │   ├── models.py            # Modelos de base de datos
│   │   ├── schemas.py           # Esquemas Pydantic
│   │   ├── auth.py              # JWT y autenticación
│   │   ├── api/                 # Rutas de la API
│   │   │   ├── auth.py          # Login
│   │   │   ├── sellers.py       # CRUD sellers
│   │   │   ├── drivers.py       # CRUD drivers
│   │   │   ├── envios.py        # Consulta de envíos
│   │   │   ├── ingesta.py       # Upload y procesamiento Excel
│   │   │   ├── liquidacion.py   # Cálculo y PDFs
│   │   │   ├── productos.py     # Productos con extra
│   │   │   ├── comunas.py       # Tarifas por comuna
│   │   │   ├── ajustes.py       # Ajustes de liquidación
│   │   │   ├── retiros.py       # Gestión de retiros
│   │   │   ├── consultas.py     # Consultas del portal
│   │   │   └── dashboard.py     # Estadísticas
│   │   └── services/
│   │       ├── ingesta.py       # Motor de procesamiento Excel
│   │       ├── liquidacion.py   # Motor de cálculo
│   │       └── pdf_generator.py # Generación de PDFs
│   ├── seed.py                  # Datos iniciales
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.jsx              # Rutas
│       ├── api.js               # Cliente Axios
│       ├── components/          # Componentes reutilizables
│       ├── context/             # AuthContext
│       └── pages/               # Admin, Seller, Driver
├── docker-compose.yml           # PostgreSQL
└── README.md
```

## Módulos del Sistema

### Motor de Ingesta
- Sube el archivo Excel del software de gestión
- Homologa automáticamente nombres de sellers y drivers usando aliases
- Detecta productos con extra vía código MLC en la descripción
- Calcula extras por comuna
- Cola de revisión para nombres no homologados

### Motor de Liquidación
- Calcula cobros a sellers (base + extras + retiros + ajustes + IVA)
- Calcula pagos a drivers (base + extras + retiros + ajustes)
- Análisis de rentabilidad por seller

### Generación de PDFs
- PDFs de liquidación para sellers (detalle + resumen con IVA)
- PDFs de liquidación para drivers (detalle + resumen)

### Portal de Transparencia
- Sellers ven sus envíos y cobros
- Drivers ven sus entregas y pagos
- Sistema de consultas bidireccional

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/setup` | Crear admin inicial |
| GET/POST | `/api/sellers` | Listar / Crear sellers |
| GET/PUT/DELETE | `/api/sellers/{id}` | CRUD seller |
| GET/POST | `/api/drivers` | Listar / Crear drivers |
| GET/PUT/DELETE | `/api/drivers/{id}` | CRUD driver |
| GET | `/api/envios` | Listar envíos |
| POST | `/api/ingesta/upload` | Subir reporte Excel |
| GET | `/api/ingesta/pendientes` | Homologaciones pendientes |
| POST | `/api/ingesta/resolver` | Resolver homologación |
| GET | `/api/liquidacion/sellers` | Cobros a sellers |
| GET | `/api/liquidacion/drivers` | Pagos a drivers |
| GET | `/api/liquidacion/rentabilidad` | Rentabilidad |
| GET | `/api/liquidacion/pdf/seller/{id}` | PDF seller |
| GET | `/api/liquidacion/pdf/driver/{id}` | PDF driver |
| GET/POST | `/api/productos` | Productos con extra |
| GET/POST | `/api/comunas` | Tarifas por comuna |
| GET/POST | `/api/ajustes` | Ajustes de liquidación |
| GET/POST | `/api/retiros` | Retiros |
| GET/POST | `/api/consultas` | Consultas del portal |
| GET | `/api/dashboard/stats` | Estadísticas |
