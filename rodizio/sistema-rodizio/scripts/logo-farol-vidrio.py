# Rodizio Cucuta - ParaTouch / Deyvid (DJG . djgv . Mxi . 0808 . 0724 . uwu)
"""
Pinta los vidrios del farol en los logos con la luz cálida del ícono
(opción C, 2026-10-07: claro al centro, ámbar en los bordes — mismos colores
que LUZ_VIDRIO en scripts/generar-iconos.py). Antes (2026-10-06) eran rojos.

Se aplicó UNA vez sobre los originales grises y los resultados ya están en el
repo; queda acá para poder repetirlo si se recupera un original desde git:

    git show dd84a9c:tienda/brand/logo-white.webp > /tmp/blanco.webp
    python scripts/logo-farol-vidrio.py blanco /tmp/blanco.webp salida.webp
    git show dd84a9c:tienda/brand/logo-dark-trans.webp > /tmp/oscuro.webp
    python scripts/logo-farol-vidrio.py oscuro /tmp/oscuro.webp salida.webp

Relleno por zonas desde el centro de cada vidrio: solo cambian los píxeles
conectados a ese vidrio (el marco, el poste, el círculo y las letras no se
tocan). El degradado sale del centro de los dos vidrios juntos, así se lee
como una sola luz detrás. Requiere Pillow.

- logo-white (1101x421, encabezados oscuros): los vidrios son grises
  (#838384 / #5D5D5E) rodeados por el marco oscuro.
- logo-dark-trans (238x96, fondos claros): el farol está dibujado "al revés":
  sus líneas son transparentes y los vidrios son el relleno oscuro entre
  ellas.
"""
import sys
from collections import deque
from PIL import Image

CENTRO, BORDE = (0xFF, 0xEA, 0xB0), (0xEE, 0x9F, 0x2E)
CONFIG = {
    'blanco': {
        'semillas': [(907, 135), (985, 135)],
        'caja': (860, 30, 1060, 280),
        'es_vidrio': lambda p: p[3] > 200 and max(p[:3]) - min(p[:3]) <= 10 and 78 <= p[0] <= 215,
    },
    'oscuro': {
        'semillas': [(194, 32), (208, 32)],
        'caja': (180, 4, 236, 60),
        'es_vidrio': lambda p: p[3] >= 200,
    },
}


def recolorear(modo, origen, destino):
    cfg = CONFIG[modo]
    im = Image.open(origen).convert('RGBA')
    px = im.load()
    x0, y0, x1, y1 = cfg['caja']
    por_vidrio, zona = [], []
    for sx, sy in cfg['semillas']:
        visto, cola, n = set(), deque([(sx, sy)]), 0
        while cola:
            x, y = cola.popleft()
            if (x, y) in visto or not (x0 <= x < x1 and y0 <= y < y1):
                continue
            visto.add((x, y))
            if not cfg['es_vidrio'](px[x, y]):
                continue
            zona.append((x, y))
            n += 1
            cola.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
        por_vidrio.append(n)
    # Puntitos sueltos (textura del original) que el relleno no alcanzó:
    # un píxel opaco rodeado casi todo de vidrio también es vidrio.
    dentro = set(zona)
    for _ in range(3):
        nuevos = [(x, y) for x in range(x0, x1) for y in range(y0, y1)
                  if (x, y) not in dentro and px[x, y][3] > 200
                  and sum((x + dx, y + dy) in dentro for dx in (-1, 0, 1) for dy in (-1, 0, 1)) >= 5]
        dentro.update(nuevos)
        zona.extend(nuevos)
    cx = sum(x for x, _ in zona) / len(zona)
    cy = sum(y for _, y in zona) / len(zona)
    r = max(((x - cx) ** 2 + (y - cy) ** 2) ** .5 for x, y in zona) or 1
    for x, y in zona:
        t = min(1, ((x - cx) ** 2 + (y - cy) ** 2) ** .5 / r)
        color = tuple(round(a + (b - a) * t) for a, b in zip(CENTRO, BORDE))
        px[x, y] = (*color, px[x, y][3])
    im.save(destino, 'WEBP', lossless=True)
    print('píxeles por vidrio:', por_vidrio)


if __name__ == '__main__':
    recolorear(sys.argv[1], sys.argv[2], sys.argv[3])
