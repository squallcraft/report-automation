"""
Asistente IA — router FastAPI.
Usa google-genai (nuevo SDK) con Gemini 2.0 Flash y Function Calling.
Incluye exponential backoff para manejar rate limits del Free Tier.
"""
import json
import time
import logging
from typing import List

from google import genai
from google.genai import types
from google.genai.errors import ClientError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import require_admin_or_administracion
from app.config import get_settings
from app.database import get_db
from app.services.chat_tools import ejecutar_tool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Asistente IA"])

MSG_RATE_LIMIT = (
    "Estoy procesando mucha información ahora mismo. "
    "Por favor, espera unos 20 segundos y vuelve a intentarlo."
)
MAX_RETRIES = 3
MAX_TOOL_ROUNDS = 5

# ─── Schemas ─────────────────────────────────────────────────────────────────

class MensajeChat(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    mensaje: str
    historial: List[MensajeChat] = []

class ChatResponse(BaseModel):
    respuesta: str
    tools_usadas: List[str] = []

# ─── Tool definitions ────────────────────────────────────────────────────────

def _schema(props: dict, required: list = None) -> types.Schema:
    schema_props = {}
    for k, v in props.items():
        schema_props[k] = types.Schema(type=v["type"].upper(), description=v.get("description", ""))
    return types.Schema(type="OBJECT", properties=schema_props, required=required or [])

TOOLS = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="consultar_envios",
        description="Resumen de envíos con filtros. Devuelve totales, margen y top sellers/drivers/comunas.",
        parameters=_schema({
            "semana": {"type": "integer", "description": "Semana (1-5)"},
            "mes": {"type": "integer", "description": "Mes (1-12)"},
            "anio": {"type": "integer", "description": "Año"},
            "seller_nombre": {"type": "string", "description": "Nombre parcial del seller"},
            "driver_nombre": {"type": "string", "description": "Nombre parcial del driver"},
            "comuna": {"type": "string", "description": "Comuna"},
        }),
    ),
    types.FunctionDeclaration(
        name="buscar_envio_por_tracking",
        description="Detalle de un envío por tracking ID.",
        parameters=_schema(
            {"tracking_id": {"type": "string", "description": "Tracking ID"}},
            required=["tracking_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="obtener_liquidacion_seller",
        description="Liquidación semanal de un seller: monto, extras, IVA, total.",
        parameters=_schema({
            "seller_nombre": {"type": "string", "description": "Nombre del seller"},
            "semana": {"type": "integer", "description": "Semana (1-5)"},
            "mes": {"type": "integer", "description": "Mes (1-12)"},
            "anio": {"type": "integer", "description": "Año"},
        }, required=["seller_nombre", "semana", "mes", "anio"]),
    ),
    types.FunctionDeclaration(
        name="obtener_ranking_drivers",
        description="Ranking de drivers por envíos y monto pagado.",
        parameters=_schema({
            "semana": {"type": "integer", "description": "Semana (1-5)"},
            "mes": {"type": "integer", "description": "Mes (1-12)"},
            "anio": {"type": "integer", "description": "Año"},
        }),
    ),
    types.FunctionDeclaration(
        name="obtener_resumen_facturacion",
        description="Facturación mensual: facturas, montos y estados de cobro.",
        parameters=_schema({
            "mes": {"type": "integer", "description": "Mes (1-12)"},
            "anio": {"type": "integer", "description": "Año"},
        }, required=["mes", "anio"]),
    ),
    types.FunctionDeclaration(
        name="obtener_rentabilidad",
        description="Rentabilidad por seller: ingresos, costos y margen.",
        parameters=_schema({
            "semana": {"type": "integer", "description": "Semana (1-5)"},
            "mes": {"type": "integer", "description": "Mes (1-12)"},
            "anio": {"type": "integer", "description": "Año"},
        }),
    ),
    types.FunctionDeclaration(
        name="listar_sellers",
        description="Sellers activos con tarifa base.",
        parameters=_schema({}),
    ),
    types.FunctionDeclaration(
        name="listar_drivers",
        description="Drivers activos con tarifas.",
        parameters=_schema({}),
    ),
])

SYSTEM_PROMPT = (
    "Eres el Asistente de ECourier, sistema logístico chileno. "
    "Consulta datos reales con las herramientas; NUNCA inventes cifras.\n"
    "Sellers = empresas cliente. Drivers = conductores. "
    "Liquidación = cobros semanales (IVA 19%). Semanas 1-5 por mes.\n"
    "Reglas: usa herramientas antes de responder, tablas Markdown para listas, "
    "formato CLP ($170.000), español profesional y conciso."
)


# ─── Gemini call with exponential backoff ─────────────────────────────────────

def _call_gemini(client, contents, config):
    """Llama a Gemini con reintentos exponenciales ante rate limits (429)."""
    for attempt in range(MAX_RETRIES):
        try:
            return client.models.generate_content(
                model="gemini-2.0-flash",
                contents=contents,
                config=config,
            )
        except ClientError as e:
            if e.status_code == 429 and attempt < MAX_RETRIES - 1:
                wait = 2 ** (attempt + 1)
                logger.warning("Gemini rate limit (429), reintento %d en %ds", attempt + 1, wait)
                time.sleep(wait)
                continue
            raise
    return None


# ─── Endpoint principal ───────────────────────────────────────────────────────

@router.post("/mensaje", response_model=ChatResponse)
def chat_mensaje(
    req: ChatRequest,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY no configurada. Agrégala al archivo .env del backend.",
        )

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    history = []
    for msg in req.historial:
        history.append(types.Content(
            role=msg.role,
            parts=[types.Part.from_text(text=msg.content)],
        ))

    history.append(types.Content(
        role="user",
        parts=[types.Part.from_text(text=req.mensaje)],
    ))

    tools_usadas: List[str] = []
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=[TOOLS],
    )

    try:
        response = _call_gemini(client, history, config)
    except ClientError as e:
        if e.status_code == 429:
            return ChatResponse(respuesta=MSG_RATE_LIMIT, tools_usadas=[])
        logger.error("Gemini error: %s", e)
        return ChatResponse(respuesta="Error al conectar con el asistente. Intenta de nuevo en unos segundos.", tools_usadas=[])
    except Exception as e:
        logger.error("Gemini unexpected error: %s", e)
        return ChatResponse(respuesta="Error al conectar con el asistente. Intenta de nuevo.", tools_usadas=[])

    for _ in range(MAX_TOOL_ROUNDS):
        tool_calls = []
        if response and response.candidates and response.candidates[0].content:
            for part in response.candidates[0].content.parts:
                if part.function_call:
                    tool_calls.append(part.function_call)

        if not tool_calls:
            break

        fn_responses = []
        for fc in tool_calls:
            tool_name = fc.name
            tool_args = dict(fc.args) if fc.args else {}
            tools_usadas.append(tool_name)

            try:
                result = ejecutar_tool(db, tool_name, tool_args)
            except Exception:
                result = {"error": f"Error interno al ejecutar {tool_name}"}

            fn_responses.append(types.Part.from_function_response(
                name=tool_name,
                response={"result": json.dumps(result, ensure_ascii=False)},
            ))

        history.append(response.candidates[0].content)
        history.append(types.Content(role="user", parts=fn_responses))

        try:
            response = _call_gemini(client, history, config)
        except ClientError as e:
            if e.status_code == 429:
                return ChatResponse(respuesta=MSG_RATE_LIMIT, tools_usadas=list(set(tools_usadas)))
            return ChatResponse(respuesta="Error al procesar la consulta. Intenta de nuevo.", tools_usadas=list(set(tools_usadas)))
        except Exception:
            return ChatResponse(respuesta="Error inesperado. Intenta de nuevo.", tools_usadas=list(set(tools_usadas)))

    texto_final = ""
    if response and response.candidates and response.candidates[0].content:
        for part in response.candidates[0].content.parts:
            if part.text:
                texto_final += part.text

    if not texto_final:
        texto_final = "No pude generar una respuesta. Intenta reformular la pregunta."

    return ChatResponse(respuesta=texto_final, tools_usadas=list(set(tools_usadas)))
