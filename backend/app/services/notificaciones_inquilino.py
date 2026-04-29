"""
Notificaciones para inquilinos (arriendo Tracking Tech).

Canales:
  - Email vía SMTP (mismo servidor que reset de contraseña)
  - WhatsApp Cloud (reutiliza enviar_wa_a_trabajador con stub)
  - Alertas a admin vía notificar_rrhh (permiso "inquilinos:ver")

Todas las funciones son best-effort: nunca levantan excepciones al caller.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import smtplib
from datetime import date
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email import encoders
from typing import Optional

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Inquilino, CobrosInquilino
from app.services.notificaciones import notificar_rrhh

logger = logging.getLogger(__name__)


def _ejecutar_async(coro):
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    fut = asyncio.ensure_future(coro)
    return loop.run_until_complete(fut) if not loop.is_running() else None


def _fmt_clp(n: int) -> str:
    return "$" + f"{int(n or 0):,}".replace(",", ".")


def _send_email(
    to_email: str,
    subject: str,
    html_body: str,
    pdf_b64: Optional[str] = None,
    pdf_filename: str = "factura.pdf",
    extra_b64: Optional[str] = None,
    extra_filename: str = "adjunto.pdf",
) -> bool:
    """Envío SMTP con adjuntos opcionales. Retorna True si éxito."""
    settings = get_settings()
    if not settings.SMTP_USER or not settings.SMTP_PASS:
        logger.warning("SMTP no configurado — email no enviado a %s", to_email)
        return False

    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_USER
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    if pdf_b64:
        try:
            part = MIMEBase("application", "pdf")
            part.set_payload(base64.b64decode(pdf_b64))
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{pdf_filename}"')
            msg.attach(part)
        except Exception as exc:
            logger.warning("Error adjuntando PDF factura: %s", exc)

    if extra_b64:
        try:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(base64.b64decode(extra_b64))
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{extra_filename}"')
            msg.attach(part)
        except Exception as exc:
            logger.warning("Error adjuntando archivo extra: %s", exc)

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(settings.SMTP_USER, settings.SMTP_PASS)
            smtp.sendmail(settings.SMTP_USER, [to_email], msg.as_string())
        logger.info("Email enviado a %s — %s", to_email, subject)
        return True
    except Exception as exc:
        logger.error("Error enviando email a %s: %s", to_email, exc)
        return False


def _html_cobro(inquilino: Inquilino, cobro: CobrosInquilino) -> str:
    anio_actual = date.today().year
    nombre = inquilino.razon_social or inquilino.nombre_fantasia or inquilino.email
    vencimiento = cobro.fecha_vencimiento.strftime("%d/%m/%Y") if cobro.fecha_vencimiento else "—"
    return f"""
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr>
          <td style="background:#003a8c;padding:28px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">E-Courier — Tracking Tech</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 12px;font-size:15px;color:#1a1a1a;">Estimados/as <strong>{nombre}</strong>,</p>
            <p style="margin:0 0 24px;font-size:14px;color:#444;">
              Les informamos que se ha emitido su cobro y factura del software <strong>Tracking Tech</strong>.
              Por favor revisen los detalles a continuación y adjunten el comprobante de pago en el portal antes del vencimiento.
            </p>
            <!-- Tabla desglose -->
            <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;">
              <tr style="background:#eff6ff;">
                <td style="border-bottom:1px solid #e2e8f0;color:#003a8c;font-weight:700;">Concepto</td>
                <td style="border-bottom:1px solid #e2e8f0;color:#003a8c;font-weight:700;text-align:right;">Monto</td>
              </tr>
              <tr>
                <td style="border-bottom:1px solid #f1f5f9;color:#444;">
                  Software Tracking Tech — {cobro.variable_nombre}: {cobro.variable_valor:,}
                </td>
                <td style="border-bottom:1px solid #f1f5f9;color:#444;text-align:right;">{_fmt_clp(cobro.monto_neto)}</td>
              </tr>
              {'<tr><td style="border-bottom:1px solid #f1f5f9;color:#16a34a;">Descuento aplicado</td><td style="border-bottom:1px solid #f1f5f9;color:#16a34a;text-align:right;">-' + _fmt_clp(cobro.descuento_aplicado) + '</td></tr>' if cobro.descuento_aplicado else ''}
              {'<tr><td style="border-bottom:1px solid #f1f5f9;color:#16a34a;">Reserva descontada</td><td style="border-bottom:1px solid #f1f5f9;color:#16a34a;text-align:right;">Aplicada</td></tr>' if cobro.reserva_descontada else ''}
              <tr>
                <td style="border-bottom:1px solid #f1f5f9;color:#444;">IVA (19%)</td>
                <td style="border-bottom:1px solid #f1f5f9;color:#444;text-align:right;">{_fmt_clp(cobro.iva)}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="font-weight:700;color:#003a8c;font-size:14px;">TOTAL A PAGAR</td>
                <td style="font-weight:700;color:#003a8c;font-size:14px;text-align:right;">{_fmt_clp(cobro.total)}</td>
              </tr>
            </table>
            <!-- Vencimiento -->
            <p style="margin:20px 0 0;font-size:13px;color:#666;">
              <strong>Fecha de vencimiento:</strong> {vencimiento}
            </p>
            <p style="margin:8px 0 24px;font-size:13px;color:#888;">
              Por favor adjunten el comprobante de transferencia en su portal antes del vencimiento.
              Si tienen consultas, no duden en contactarnos.
            </p>
            <a href="#" style="display:inline-block;padding:12px 28px;background:#003a8c;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
              Ir al Portal
            </a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">
              E-Courier SPA © {anio_actual} | Este correo es generado automáticamente, por favor no responder directamente.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def notificar_cobro(
    db: Session,
    inquilino: Inquilino,
    cobro: CobrosInquilino,
    archivo_adjunto_b64: Optional[str] = None,
) -> None:
    """
    Envía email corporativo + WhatsApp al inquilino informando del cobro emitido.
    Adjunta la factura PDF si está disponible.
    """
    destinatario = inquilino.correo_contacto or inquilino.correo_empresa or inquilino.email
    subject = "Se ha emitido tu cobro y factura de su software Tracking Tech"

    html = _html_cobro(inquilino, cobro)
    _send_email(
        to_email=destinatario,
        subject=subject,
        html_body=html,
        pdf_b64=cobro.pdf_factura_b64,
        pdf_filename=f"factura_{cobro.mes:02d}_{cobro.anio}.pdf",
        extra_b64=archivo_adjunto_b64,
        extra_filename="informacion_adicional.pdf",
    )

    notificar_cobro_whatsapp(inquilino, cobro)


def notificar_cobro_whatsapp(inquilino: Inquilino, cobro: CobrosInquilino) -> None:
    """Envía mensaje WhatsApp al inquilino con resumen del cobro."""
    if not inquilino.whatsapp:
        return
    try:
        from app.services.whatsapp_trabajadores import enviar_wa_a_trabajador
        from app.models import Trabajador as _T

        nombre = inquilino.razon_social or inquilino.nombre_fantasia or inquilino.email
        venc = cobro.fecha_vencimiento.strftime("%d/%m/%Y") if cobro.fecha_vencimiento else "—"
        texto = (
            f"*E-Courier — Tracking Tech*\n"
            f"Hola *{nombre}*, se ha emitido su cobro de software.\n"
            f"Total: *{_fmt_clp(cobro.total)}* | Vencimiento: *{venc}*\n"
            f"Ingrese al portal para adjuntar su comprobante de pago."
        )
        stub = _T(id=inquilino.id, nombre=nombre, whatsapp=inquilino.whatsapp)
        _ejecutar_async(enviar_wa_a_trabajador(stub, texto))
    except Exception as exc:
        logger.warning("WA cobro inquilino %s: %s", inquilino.id, exc)


def notificar_inicio_despliegue(db: Session, inquilino: Inquilino) -> None:
    """
    Notifica al inquilino que su servicio ha sido activado,
    indicando fecha de inicio y si tiene mes de cortesía.
    """
    destinatario = inquilino.correo_contacto or inquilino.correo_empresa or inquilino.email
    nombre = inquilino.razon_social or inquilino.nombre_fantasia or inquilino.email
    inicio = inquilino.fecha_inicio_despliegue.strftime("%d/%m/%Y") if inquilino.fecha_inicio_despliegue else "—"
    inicio_factura = inquilino.fecha_inicio_facturacion.strftime("%d/%m/%Y") if inquilino.fecha_inicio_facturacion else "—"
    cortesia_txt = (
        f"Su plan incluye <strong>un mes de cortesía</strong>. La facturación comenzará el {inicio_factura}."
        if inquilino.mes_gratis_confirmado
        else f"La facturación comenzará a partir del {inicio_factura}."
    )

    anio_actual = date.today().year
    html = f"""
<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:32px 0;">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;margin:0 auto;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <tr><td style="background:#003a8c;padding:28px 40px;">
      <h1 style="margin:0;color:#fff;font-size:20px;">¡Su servicio Tracking Tech ha sido activado!</h1>
    </td></tr>
    <tr><td style="padding:36px 40px;">
      <p style="font-size:15px;color:#1a1a1a;">Estimados/as <strong>{nombre}</strong>,</p>
      <p style="font-size:14px;color:#444;">
        Con fecha <strong>{inicio}</strong>, hemos activado su acceso al software <strong>Tracking Tech</strong>.
      </p>
      <p style="font-size:14px;color:#444;">{cortesia_txt}</p>
      <p style="font-size:13px;color:#888;">
        Si tiene consultas técnicas o comerciales, no dude en contactarnos.
      </p>
    </td></tr>
    <tr><td style="padding:16px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">E-Courier SPA © {anio_actual}</p>
    </td></tr>
  </table>
</body></html>
"""
    _send_email(
        to_email=destinatario,
        subject="Su servicio Tracking Tech ha sido activado",
        html_body=html,
    )

    # WhatsApp
    if inquilino.whatsapp:
        try:
            from app.services.whatsapp_trabajadores import enviar_wa_a_trabajador
            from app.models import Trabajador as _T
            cortesia_wa = "Tiene un mes de cortesía incluido." if inquilino.mes_gratis_confirmado else ""
            texto = (
                f"*E-Courier — Tracking Tech*\n"
                f"¡Bienvenidos/as *{nombre}*!\n"
                f"Su servicio ha sido activado el *{inicio}*. {cortesia_wa}\n"
                f"La facturación comienza el *{inicio_factura}*."
            )
            stub = _T(id=inquilino.id, nombre=nombre, whatsapp=inquilino.whatsapp)
            _ejecutar_async(enviar_wa_a_trabajador(stub, texto))
        except Exception as exc:
            logger.warning("WA despliegue inquilino %s: %s", inquilino.id, exc)


def alerta_cobro_vencido(db: Session, cobro: CobrosInquilino) -> None:
    """
    Alerta al admin (permiso inquilinos:ver) cuando un cobro lleva más de 10 días sin pago.
    Reutiliza notificar_rrhh directamente.
    """
    from app.models import Inquilino as _Inq
    inquilino = db.get(_Inq, cobro.inquilino_id)
    nombre = inquilino.razon_social if inquilino else f"Inquilino #{cobro.inquilino_id}"
    venc = cobro.fecha_vencimiento.strftime("%d/%m/%Y") if cobro.fecha_vencimiento else "—"
    notificar_rrhh(
        db,
        permiso_slug="inquilinos:ver",
        titulo=f"Cobro vencido — {nombre}",
        mensaje=(
            f"El cobro de {nombre} ({cobro.mes}/{cobro.anio}) venció el {venc} "
            f"y aún no registra pago. Total: {_fmt_clp(cobro.total)}."
        ),
        url_accion=f"/admin/inquilinos/{cobro.inquilino_id}",
    )
