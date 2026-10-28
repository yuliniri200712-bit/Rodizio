"""Vectoriza un ícono negro-sobre-transparente a un <path> SVG (potrace).

Uso: python vectorizar.py entrada.png salida.svg [lado_viewbox]
Escala las coordenadas a un viewBox cuadrado (24 por defecto) con 2
decimales, para que el path quede corto y se pueda poner inline.
"""
import sys
import numpy as np
import potrace
from PIL import Image

entrada, salida = sys.argv[1], sys.argv[2]
lado = float(sys.argv[3]) if len(sys.argv) > 3 else 24.0

im = Image.open(entrada).convert('RGBA')
# Subir a 1024 antes de trazar: potrace saca curvas más limpias.
im = im.resize((1024, 1024), Image.LANCZOS)
# Engrosar la línea (MaxFilter sobre el alfa): la original mide ~3% del
# lado y a 16 px se perdía; así queda cerca del grosor de Lucide.
from PIL import ImageFilter
grosor = int(sys.argv[4]) if len(sys.argv) > 4 else 0
if grosor:
    a = im.getchannel('A').filter(ImageFilter.MaxFilter(grosor))
    im.putalpha(a)
alfa = np.array(im)[:, :, 3]
mapa = alfa <= 127  # potracer traza lo "falso" como tinta
bm = potrace.Bitmap(mapa)
traza = bm.trace(turdsize=8, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
                 alphamax=1.0, opticurve=True, opttolerance=0.2)

k = lado / 1024.0
def f(v):
    s = f'{v * k:.2f}'.rstrip('0').rstrip('.')
    return s if s not in ('-0', '') else '0'

partes = []
for curva in traza:
    p = curva.start_point
    d = [f'M{f(p.x)} {f(p.y)}']
    for seg in curva:
        if seg.is_corner:
            d.append(f'L{f(seg.c.x)} {f(seg.c.y)}L{f(seg.end_point.x)} {f(seg.end_point.y)}')
        else:
            d.append(f'C{f(seg.c1.x)} {f(seg.c1.y)} {f(seg.c2.x)} {f(seg.c2.y)} {f(seg.end_point.x)} {f(seg.end_point.y)}')
    d.append('Z')
    partes.append(''.join(d))

path = ''.join(partes)
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {lado:g} {lado:g}" '
       f'fill="currentColor" fill-rule="evenodd"><path d="{path}"/></svg>')
open(salida, 'w', encoding='utf-8').write(svg)
print(salida, len(path), 'chars,', len(traza), 'curvas')
