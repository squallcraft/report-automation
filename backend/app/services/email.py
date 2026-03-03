"""
Envío de email sincrónico con smtplib (sin Celery/Redis).
Usado para reset de contraseña.
"""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import get_settings

logger = logging.getLogger(__name__)


def send_reset_email(to_email: str, reset_url: str) -> bool:
    """
    Envía el email de reset de contraseña.
    Retorna True si se envió, False si SMTP no está configurado o falla.
    El caller nunca debe levantar error al usuario aunque falle (anti-leak).
    """
    settings = get_settings()
    if not settings.SMTP_USER or not settings.SMTP_PASS:
        logger.warning("SMTP no configurado — email de reset no enviado a %s", to_email)
        logger.info("URL de reset (solo en desarrollo): %s", reset_url)
        return False

    subject = "ECourier — Restablecer contraseña"
    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <h2 style="color:#1e3a5f;">ECourier — Restablecer contraseña</h2>
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
      <p>Haz clic en el botón para crear una nueva contraseña. El enlace es válido por <strong>1 hora</strong>.</p>
      <a href="{reset_url}"
         style="display:inline-block;margin:16px 0;padding:12px 24px;
                background:#1e3a5f;color:#fff;text-decoration:none;
                border-radius:8px;font-weight:bold;">
        Restablecer contraseña
      </a>
      <p style="color:#666;font-size:13px;">
        Si no solicitaste este cambio, ignora este mensaje. Tu contraseña actual sigue siendo válida.
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p style="color:#aaa;font-size:11px;">ECourier © {__import__('datetime').date.today().year}</p>
    </div>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_USER
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(settings.SMTP_USER, settings.SMTP_PASS)
            smtp.sendmail(settings.SMTP_USER, [to_email], msg.as_string())
        logger.info("Email de reset enviado a %s", to_email)
        return True
    except Exception as exc:
        logger.error("Error enviando email de reset a %s: %s", to_email, exc)
        return False
