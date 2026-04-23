"""Genera un código QR para https://e-courier.cl con el texto 'ECOURIER' en el centro.

Produce dos archivos en la raíz del proyecto:
    - ecourier_qr.svg  (vectorial, ideal para imprimir / escalar)
    - ecourier_qr.png  (raster, sólo si Pillow está disponible)

Uso:
    pip install qrcode
    # opcional para PNG:
    pip install pillow

    python scripts/generar_qr_ecourier.py
"""

from __future__ import annotations

from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_H

URL = "https://e-courier.cl"
TEXTO_CENTRO = "ECOURIER"

RAIZ = Path(__file__).resolve().parent.parent
ARCHIVO_SVG = RAIZ / "ecourier_qr.svg"
ARCHIVO_PNG = RAIZ / "ecourier_qr.png"

COLOR_QR = "#1a1a1a"
COLOR_FONDO = "#ffffff"
COLOR_CAJA = "#FF6B00"
COLOR_TEXTO = "#ffffff"


def _construir_matriz() -> list[list[bool]]:
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=1,
        border=0,
    )
    qr.add_data(URL)
    qr.make(fit=True)
    return qr.get_matrix()


def generar_svg(matriz: list[list[bool]]) -> Path:
    n = len(matriz)
    box = 20
    border = 2 * box
    tamano = n * box + border * 2

    ancho_caja = int(n * box * 0.42)
    alto_caja = int(n * box * 0.13)
    cx = tamano // 2
    cy = tamano // 2
    x0 = cx - ancho_caja // 2
    y0 = cy - alto_caja // 2

    margen_blanco = 8
    radio = alto_caja // 4

    rects: list[str] = []
    for y, fila in enumerate(matriz):
        x = 0
        while x < n:
            if fila[x]:
                inicio = x
                while x < n and fila[x]:
                    x += 1
                ancho = x - inicio
                rects.append(
                    f'<rect x="{border + inicio * box}" y="{border + y * box}" '
                    f'width="{ancho * box}" height="{box}" fill="{COLOR_QR}"/>'
                )
            else:
                x += 1

    tamano_fuente = int(alto_caja * 0.6)

    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {tamano} {tamano}" width="{tamano}" height="{tamano}">
  <rect width="100%" height="100%" fill="{COLOR_FONDO}"/>
  {''.join(rects)}
  <rect x="{x0 - margen_blanco}" y="{y0 - margen_blanco}"
        width="{ancho_caja + margen_blanco * 2}" height="{alto_caja + margen_blanco * 2}"
        rx="{radio + 4}" ry="{radio + 4}" fill="{COLOR_FONDO}"/>
  <rect x="{x0}" y="{y0}" width="{ancho_caja}" height="{alto_caja}"
        rx="{radio}" ry="{radio}" fill="{COLOR_CAJA}"/>
  <text x="{cx}" y="{cy}" text-anchor="middle" dominant-baseline="central"
        font-family="Helvetica, Arial, sans-serif" font-weight="bold"
        font-size="{tamano_fuente}" fill="{COLOR_TEXTO}"
        letter-spacing="1">{TEXTO_CENTRO}</text>
</svg>
"""
    ARCHIVO_SVG.write_text(svg, encoding="utf-8")
    return ARCHIVO_SVG


def generar_png(matriz: list[list[bool]]) -> Path | None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except Exception as exc:
        print(f"[aviso] No se generó PNG (Pillow no disponible): {exc}")
        return None

    n = len(matriz)
    box = 16
    border = 2 * box
    tamano = n * box + border * 2

    img = Image.new("RGB", (tamano, tamano), COLOR_FONDO)
    draw = ImageDraw.Draw(img)

    for y, fila in enumerate(matriz):
        for x, es_negro in enumerate(fila):
            if es_negro:
                px = border + x * box
                py = border + y * box
                draw.rectangle([px, py, px + box - 1, py + box - 1], fill=COLOR_QR)

    ancho_caja = int(n * box * 0.42)
    alto_caja = int(n * box * 0.13)
    cx = tamano // 2
    cy = tamano // 2
    x0 = cx - ancho_caja // 2
    y0 = cy - alto_caja // 2
    x1 = x0 + ancho_caja
    y1 = y0 + alto_caja

    radio = alto_caja // 4
    draw.rounded_rectangle(
        [(x0 - 8, y0 - 8), (x1 + 8, y1 + 8)],
        radius=radio + 4,
        fill=COLOR_FONDO,
    )
    draw.rounded_rectangle(
        [(x0, y0), (x1, y1)],
        radius=radio,
        fill=COLOR_CAJA,
    )

    candidatos = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    fuente = None
    tamano_fuente = int(alto_caja * 0.6)
    for ruta in candidatos:
        if Path(ruta).exists():
            try:
                fuente = ImageFont.truetype(ruta, tamano_fuente)
                break
            except OSError:
                continue
    if fuente is None:
        fuente = ImageFont.load_default()

    while tamano_fuente > 8:
        bbox = draw.textbbox((0, 0), TEXTO_CENTRO, font=fuente)
        ancho_texto = bbox[2] - bbox[0]
        alto_texto = bbox[3] - bbox[1]
        if ancho_texto <= ancho_caja * 0.85 and alto_texto <= alto_caja * 0.75:
            break
        tamano_fuente -= 2
        try:
            fuente = ImageFont.truetype(candidatos[0], tamano_fuente)
        except Exception:
            break

    bbox = draw.textbbox((0, 0), TEXTO_CENTRO, font=fuente)
    ancho_texto = bbox[2] - bbox[0]
    alto_texto = bbox[3] - bbox[1]
    tx = x0 + (ancho_caja - ancho_texto) // 2 - bbox[0]
    ty = y0 + (alto_caja - alto_texto) // 2 - bbox[1]
    draw.text((tx, ty), TEXTO_CENTRO, fill=COLOR_TEXTO, font=fuente)

    img.save(ARCHIVO_PNG, format="PNG", optimize=True)
    return ARCHIVO_PNG


def main() -> None:
    matriz = _construir_matriz()
    print(f"Tamaño matriz QR: {len(matriz)}x{len(matriz)} módulos")
    svg = generar_svg(matriz)
    print(f"SVG generado: {svg}")
    png = generar_png(matriz)
    if png:
        print(f"PNG generado: {png}")
    print(f"URL codificada: {URL}")


if __name__ == "__main__":
    main()
