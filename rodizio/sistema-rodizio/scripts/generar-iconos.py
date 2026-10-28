# Rodizio Cucuta - ParaTouch / Deyvid (DJG . djgv . Mxi . 0808 . 0724 . uwu)
"""
Íconos de las apps: el farol de Rodizio encendido, con luz cálida de farol
de parque (opción C elegida el 2026-10-07: vidrio claro al centro que pasa a
ámbar en los bordes + resplandor suave sobre el círculo crema).

2026-10-07 (tarde): a pedido del dueño se quitó el fondo rojo (#B52A20). El
círculo crema ocupa todo el ícono y el farol es 22 % más grande. Donde el
sistema exige fondo opaco (iPhone, Android "maskable") el fondo es crema.

La guía original ("img rodizio/Guía de identidad visual Rodizio.png") es una
imagen de ~250 px por ícono: recortarla quedaba borroso, así que el farol se
redibujó en vector. Su geometría vive acá UNA sola vez y de ella salen el SVG
y todos los PNG.

    python scripts/generar-iconos.py

Escribe:
  icons/ (los 5 paneles)  icon-192, icon-512 (círculo, transparente afuera),
                          icon-maskable-512 y apple-touch-icon (fondo crema),
                          favicon.png, favicon.ico, farol.svg
  tienda/                 icon.svg, icon-192, icon-512 (fondo crema: sus
                          manifests los declaran "any maskable"),
                          apple-touch-icon, favicon-16, favicon-32, favicon.ico

Colores = tokens de shared/marca.css. Requiere Pillow y numpy.
"""
import os
import numpy as np
from PIL import Image, ImageDraw

CIRCULO, FAROL = '#F2F0EC', '#17191C'
CX, CY, R = 256, 256, 250            # círculo crema, casi a borde del lienzo
GX, GY = 256, 262                    # centro de la geometría del farol (abajo)
ESCALA = 1.22                        # farol grande (íconos "any", iPhone, favicon)
ESCALA_SEGURA = 1.0                  # maskable: entra en la zona segura del 80 %
# Luz: degradados radiales (cx, cy, r, [(offset, color, opacidad)]) en las
# coordenadas de la geometría del farol (se escalan con él).
VIDRIO = 'url(#vidrio)'              # marcador: se pinta con LUZ_VIDRIO
LUZ_VIDRIO = (256, 250, 120, [(0, '#FFEAB0', 1), (1, '#EE9F2E', 1)])
HALO = [(0, '#FFD27A', .85), (.55, '#FFD27A', .28), (1, '#FFD27A', 0)]  # sobre el círculo


def poligonos():
    """(color, puntos) en orden de pintado, sin el círculo ni el poste."""
    p = []
    # Silueta oscura de una pieza: techo macizo (grueso al centro, fino en
    # los aleros que sobresalen) y cuerpo que se angosta hacia abajo.
    p.append((FAROL, [
        (234, 122), (278, 122),            # tope plano del techo
        (394, 186), (394, 198), (372, 198),  # alero derecho
        (324, 372), (188, 372),            # fondo del cuerpo
        (140, 198), (118, 198), (118, 186),  # alero izquierdo
    ]))
    # Cuello bajo el remate.
    p.append((FAROL, [(244, 100), (268, 100), (268, 124), (244, 124)]))
    # Vidrios encendidos: el borde superior sube hacia el centro, bajo el techo.
    p.append((VIDRIO, [(163, 208), (244, 166), (244, 350), (202, 350)]))
    p.append((VIDRIO, [(268, 166), (349, 208), (310, 350), (268, 350)]))
    # Base escalonada.
    p.append((FAROL, [(190, 370), (322, 370), (322, 390), (190, 390)]))
    p.append((FAROL, [(206, 388), (306, 388), (306, 404), (206, 404)]))
    return p


POSTE = (226, 402, 286)                         # x0, y0, x1: baja hasta el borde del círculo
REMATE = (256, 86, 22)                          # bolita superior (cx, cy, r)


def svg(opaco=False, escala=ESCALA):
    """SVG del ícono. opaco=True pinta todo el cuadrado crema."""
    fondo = f'<rect width="512" height="512" fill="{CIRCULO}"/>' if opaco else ''
    pols = ''.join(f'<polygon fill="{c}" points="{" ".join(f"{x},{y}" for x, y in pts)}"/>'
                   for c, pts in poligonos())
    cx, cy, r = REMATE
    lx, ly, lr, lstops = LUZ_VIDRIO
    def grad(gid, gx, gy, gr, stops):
        st = ''.join(f'<stop offset="{o:g}" stop-color="{c}" stop-opacity="{a:g}"/>' for o, c, a in stops)
        return f'<radialGradient id="{gid}" cx="{gx}" cy="{gy}" r="{gr}" gradientUnits="userSpaceOnUse">{st}</radialGradient>'
    # El farol se dibuja en su geometría original y se escala alrededor de (GX, GY),
    # llevado al centro del círculo. El poste va dentro del mismo grupo y se
    # recorta con el círculo (clipPath en coordenadas del lienzo, fuera del grupo).
    grupo = (f'<g transform="translate({CX} {CY}) scale({escala:g}) translate({-GX} {-GY})">'
             f'{pols}<circle cx="{cx}" cy="{cy}" r="{r}" fill="{FAROL}"/></g>')
    poste = (f'<g clip-path="url(#c)"><g transform="translate({CX} {CY}) scale({escala:g}) translate({-GX} {-GY})">'
             f'<rect x="{POSTE[0]}" y="{POSTE[1]}" width="{POSTE[2]-POSTE[0]}" height="400" fill="{FAROL}"/></g></g>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            f'<defs><clipPath id="c"><circle cx="{CX}" cy="{CY}" r="{R}"/></clipPath>'
            f'{grad("vidrio", lx, ly, lr, lstops)}{grad("halo", CX, CY, R, HALO)}</defs>'
            f'{fondo}<circle cx="{CX}" cy="{CY}" r="{R}" fill="{CIRCULO}"/>'
            f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="url(#halo)"/>'
            f'{poste}{grupo}</svg>')


def radial(S, cx, cy, r, stops):
    """Imagen RGBA SxS con un degradado radial (mismo criterio que SVG:
    interpolación lineal entre stops, fuera del radio queda el último)."""
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    t = np.clip(np.hypot(xx - cx, yy - cy) / r, 0, 1)
    offs = [o for o, _, _ in stops]
    rgb = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for _, c, _ in stops]
    canales = [np.interp(t, offs, [v[j] for v in rgb]) for j in range(3)]
    canales.append(np.interp(t, offs, [a * 255 for _, _, a in stops]))
    return Image.fromarray(np.dstack(canales).astype(np.uint8), 'RGBA')


def png(lado, opaco=False, escala=ESCALA):
    """Dibuja a 8x y reduce con LANCZOS: bordes suaves sin depender de un
    renderizador de SVG. opaco=True: cuadrado crema completo (iPhone/maskable)."""
    k = 8; S = 512 * k
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if opaco:
        d.rectangle((0, 0, S, S), fill=CIRCULO)
    def t(x, y):  # geometría del farol → lienzo
        return ((CX + (x - GX) * escala) * k, (CY + (y - GY) * escala) * k)
    cx, cy, rr = CX * k, CY * k, R * k
    d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=CIRCULO)
    im.alpha_composite(radial(S, cx, cy, rr, HALO))  # su radio = el del círculo: fuera queda en 0
    # Poste hasta abajo. Con fondo transparente se recorta con el círculo;
    # con fondo crema completo llega al borde (si no, quedaba un corte
    # redondeado visible en las máscaras cuadradas de algunos launchers).
    x0, y0 = t(POSTE[0], POSTE[1]); x1, _ = t(POSTE[2], POSTE[1])
    if opaco:
        d.rectangle((x0, y0, x1, S), fill=FAROL)
    else:
        capa = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(capa).rectangle((x0, y0, x1, S), fill=FAROL)
        mascara = Image.new('L', (S, S), 0); ImageDraw.Draw(mascara).ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=255)
        im.paste(capa, (0, 0), Image.composite(capa, Image.new('RGBA', (S, S)), mascara).split()[3])
    vx, vy = t(LUZ_VIDRIO[0], LUZ_VIDRIO[1])
    luz = None
    for c, pts in poligonos():
        if c == VIDRIO:
            if luz is None:
                luz = radial(S, vx, vy, LUZ_VIDRIO[2] * escala * k, LUZ_VIDRIO[3])
            m = Image.new('L', (S, S), 0)
            ImageDraw.Draw(m).polygon([t(x, y) for x, y in pts], fill=255)
            im.paste(luz, (0, 0), m)
        else:
            d.polygon([t(x, y) for x, y in pts], fill=c)
    bx, by = t(REMATE[0], REMATE[1]); br = REMATE[2] * escala * k
    d.ellipse((bx - br, by - br, bx + br, by + br), fill=FAROL)
    return im.resize((lado, lado), Image.LANCZOS)


def guardar(im, ruta, opaco=False):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    if opaco:  # iOS y "maskable" no aceptan transparencia
        im = im.convert('RGB')
    im.save(ruta, optimize=True)


def main():
    raiz = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    icons = os.path.join(raiz, 'icons')
    tienda = os.path.join(raiz, 'tienda')

    guardar(png(192), os.path.join(icons, 'icon-192.png'))
    guardar(png(512), os.path.join(icons, 'icon-512.png'))
    guardar(png(512, True, ESCALA_SEGURA), os.path.join(icons, 'icon-maskable-512.png'), opaco=True)
    guardar(png(180, True), os.path.join(icons, 'apple-touch-icon.png'), opaco=True)
    guardar(png(32), os.path.join(icons, 'favicon.png'))
    png(256).save(os.path.join(icons, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    with open(os.path.join(icons, 'farol.svg'), 'w', encoding='utf-8') as f:
        f.write(svg())

    with open(os.path.join(tienda, 'icon.svg'), 'w', encoding='utf-8') as f:
        f.write(svg())
    guardar(png(192, True, ESCALA_SEGURA), os.path.join(tienda, 'icon-192.png'), opaco=True)
    guardar(png(512, True, ESCALA_SEGURA), os.path.join(tienda, 'icon-512.png'), opaco=True)
    guardar(png(180, True), os.path.join(tienda, 'apple-touch-icon.png'), opaco=True)
    guardar(png(16), os.path.join(tienda, 'favicon-16.png'))
    guardar(png(32), os.path.join(tienda, 'favicon-32.png'))
    png(256).save(os.path.join(tienda, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    print('íconos generados en icons/ y tienda/')


if __name__ == '__main__':
    main()
