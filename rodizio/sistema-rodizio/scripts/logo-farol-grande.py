# Rodizio Cucuta - ParaTouch / Deyvid (DJG . djgv . Mxi . 0808 . 0724 . uwu)
"""
Agranda el farol (y su círculo) del logo "RODIZIO" un 15 %, sin tocar las
letras ni la cinta "Desde 1986". Pedido del dueño el 2026-10-08, junto con el
ícono nuevo sin fondo rojo (scripts/generar-iconos.py).

Se aplicó UNA vez sobre los logos que ya tenían los vidrios cálidos
(scripts/logo-farol-vidrio.py); queda acá para poder repetirlo desde el
original en git:

    python scripts/logo-farol-grande.py blanco entrada.webp salida.webp
    python scripts/logo-farol-grande.py oscuro entrada.webp salida.webp

El farol está encajado entre la "I" (izquierda) y la cinta (abajo): se
recorta su caja, se escala, se corre a la derecha y se suma un margen
transparente arriba para que el remate no se corte. Lo que caería sobre la
"I" o sobre la cinta se recorta. Requiere Pillow.

- blanco (1101x421, encabezados oscuros): círculo ≈ centro (945, 145), r ≈ 120.
- oscuro (238x96, fondos claros): círculo ≈ centro (201, 33), r ≈ 25.
"""
import sys
from PIL import Image, ImageDraw

ESCALA = 1.15
CONFIG = {
    # caja: farol + círculo (sin letras ni cinta); centro: del círculo original;
    # nuevo_centro: en coordenadas del original; arriba: filas que se agregan;
    # zona: (x mínima tras la "I", y máxima antes de la cinta) donde puede dibujarse.
    'blanco': {'caja': (820, 0, None, 280), 'centro': (945, 145), 'nuevo_centro': (963, 140), 'arriba': 12, 'zona': (815, 284)},
    'oscuro': {'caja': (175, 0, None, 63), 'centro': (201, 33), 'nuevo_centro': (205, 33), 'arriba': 3, 'zona': (175, 63)},
}


def agrandar(im, cfg):
    W, H = im.size
    x0, y0, x1, y1 = cfg['caja']
    caja = (x0, y0, x1 or W, y1)
    recorte = im.crop(caja)
    grande = recorte.resize((round(recorte.width * ESCALA), round(recorte.height * ESCALA)), Image.LANCZOS)
    base = im.copy()
    ImageDraw.Draw(base).rectangle(caja, fill=(0, 0, 0, 0))   # borra el farol original
    arriba = cfg['arriba']
    lienzo = Image.new('RGBA', (W, H + arriba), (0, 0, 0, 0))
    lienzo.paste(base, (0, arriba))
    cx, cy = cfg['centro']; nx, ny = cfg['nuevo_centro']
    x = round(nx - (cx - caja[0]) * ESCALA)
    y = round(ny - (cy - caja[1]) * ESCALA) + arriba
    capa = Image.new('RGBA', lienzo.size, (0, 0, 0, 0))
    capa.paste(grande, (x, y), grande)
    zx, zy = cfg['zona']
    m = Image.new('L', lienzo.size, 0)
    ImageDraw.Draw(m).rectangle((zx, 0, W, zy + arriba), fill=255)
    capa.putalpha(Image.composite(capa.split()[3], Image.new('L', lienzo.size, 0), m))
    lienzo.alpha_composite(capa)
    return lienzo


if __name__ == '__main__':
    variante, entrada, salida = sys.argv[1:4]
    resultado = agrandar(Image.open(entrada).convert('RGBA'), CONFIG[variante])
    resultado.save(salida, 'WEBP', quality=95, method=6)
    print(salida, resultado.size)
