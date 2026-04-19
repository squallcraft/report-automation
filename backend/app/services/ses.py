"""
Amazon SES — envío de correos para campañas masivas.

Usa boto3 (SDK oficial de AWS) para llamar a la API de SES.
Si las credenciales no están configuradas, loggea un warning y retorna None.

Tracking de aperturas: se inyecta un pixel 1x1 transparente en el HTML
que apunta a /api/email-campaigns/track/open/{mensaje_id}.

Tracking de rebotes/quejas: SES debe estar configurado con SNS para
notificar al webhook /api/email-campaigns/webhook/sns.
"""
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger(__name__)


def _get_ses_client():
    """Construye el cliente boto3 SES. Retorna None si boto3 no está disponible o no hay credenciales."""
    try:
        import boto3
        from app.config import get_settings
        s = get_settings()
        if not s.AWS_ACCESS_KEY_ID or not s.AWS_SECRET_ACCESS_KEY or not s.SES_FROM_EMAIL:
            logger.warning("SES no configurado — AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY y SES_FROM_EMAIL son requeridos")
            return None
        return boto3.client(
            "ses",
            region_name=s.AWS_SES_REGION,
            aws_access_key_id=s.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=s.AWS_SECRET_ACCESS_KEY,
        )
    except ImportError:
        logger.error("boto3 no instalado — ejecuta: pip install boto3")
        return None


def _inject_tracking_pixel(html: str, mensaje_id: int) -> str:
    """Inyecta un pixel de tracking antes del </body> para detectar aperturas."""
    from app.config import get_settings
    backend_url = get_settings().BACKEND_URL
    pixel = (
        f'<img src="{backend_url}/api/email-campaigns/track/open/{mensaje_id}" '
        f'width="1" height="1" alt="" style="display:none;" />'
    )
    if "</body>" in html.lower():
        idx = html.lower().rfind("</body>")
        return html[:idx] + pixel + html[idx:]
    return html + pixel


def send_campaign_email(
    to_email: str,
    subject: str,
    html_body: str,
    text_body: Optional[str],
    mensaje_id: int,
) -> Optional[str]:
    """
    Envía un correo vía SES.
    Retorna el SES MessageId si tuvo éxito, None si falló.
    """
    from app.config import get_settings
    s = get_settings()

    client = _get_ses_client()
    if not client:
        return None

    html_with_pixel = _inject_tracking_pixel(html_body, mensaje_id)
    from_addr = f"{s.SES_FROM_NAME} <{s.SES_FROM_EMAIL}>" if s.SES_FROM_NAME else s.SES_FROM_EMAIL

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email

    if text_body:
        msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_with_pixel, "html", "utf-8"))

    try:
        resp = client.send_raw_email(
            Source=from_addr,
            Destinations=[to_email],
            RawMessage={"Data": msg.as_string()},
        )
        return resp["MessageId"]
    except Exception as exc:
        logger.error("Error SES enviando a %s: %s", to_email, exc)
        return None


def substitute_variables(template: str, variables: dict) -> str:
    """Reemplaza {{nombre}}, {{empresa}}, etc. en un template."""
    result = template
    for key, val in variables.items():
        result = result.replace(f"{{{{{key}}}}}", str(val) if val is not None else "")
    return result
