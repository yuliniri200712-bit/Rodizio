import base64, re, pathlib

d = pathlib.Path(__file__).parent
src = (d / "guia-reportes.html").read_text(encoding="utf-8")

def b64(name):
    return base64.b64encode((d / name).read_bytes()).decode()

fig_lat, fig_latx = b64("fig-lat.woff2"), b64("fig-latx.woff2")
cap_lat, cap_latx = b64("cap-lat.woff2"), b64("cap-latx.woff2")

LAT = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
LATX = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"

# Figtree es variable, pero Chrome (en modo impresion) no siempre resuelve
# el rango `font-weight:400 800` cuando la pagina pide un peso puntual como
# 700 u 800 -> se declara un @font-face por peso, todos apuntando al mismo
# archivo variable. Con un peso puntual, la fuente variable igual rinde.
fig_faces = "".join(
    f"@font-face{{font-family:'Figtree';font-style:normal;font-weight:{w};font-display:swap;"
    f"src:url(data:font/woff2;base64,{data}) format('woff2');unicode-range:{rng}}}\n"
    for w in (400, 500, 600, 700, 800)
    for data, rng in ((fig_lat, LAT), (fig_latx, LATX))
)
fonts_css = fig_faces + f"""
@font-face{{font-family:'Caprasimo';font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64,{cap_lat}) format('woff2');unicode-range:{LAT}}}
@font-face{{font-family:'Caprasimo';font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64,{cap_latx}) format('woff2');unicode-range:{LATX}}}
"""

# 1. quitar los <link> de Google Fonts (preconnect + stylesheet)
src = re.sub(r'\s*<link rel="preconnect"[^>]*>', '', src)
src = re.sub(r'\s*<link href="https://fonts\.googleapis[^>]*>', '', src)

# 1b. este archivo es SOLO para el PDF (papel blanco): se quitan los
#     bloques de modo oscuro para que se vea igual en pantalla y en el
#     PDF, y no dependa del tema del equipo que lo genere.
src = re.sub(r'@media \(prefers-color-scheme: ?dark\)\s*\{(?:[^{}]|\{[^{}]*\})*\}', '', src)
src = re.sub(r':root\[data-theme="dark"\]\s*\{[^}]*\}', '', src)
src = re.sub(r':root\[data-theme="dark"\][^,{]*,\s*', '', src)  # selectores compuestos con dark
src = re.sub(r':root:not\(\[data-theme="light"\]\)[^,{]*,\s*', '', src)

# 2. inyectar las fuentes embebidas al principio del <style>
src = src.replace("<style>", "<style>\n" + fonts_css, 1)

# 3. abrir todos los <details> para que el contenido salga en el PDF
src = src.replace("<details>", "<details open>")

# 4. reglas de impresion: A4, paleta CLARA forzada (el PDF va a papel
#    blanco, no debe salir en modo oscuro aunque el equipo lo tenga),
#    saltos que no cortan tarjetas, y los <details> abiertos como
#    secciones normales.
print_css = """
:root{ color-scheme:light; }
@page{ size:A4; margin:14mm 13mm; }
@media print{
  :root{
    --ground:#ffffff; --card:#fbf7f0; --card-2:#f3ebdd;
    --ink:#2c2822; --ink-2:#544c40; --ink-3:#867c6d;
    --rule:#ddd2be; --rule-soft:#e9e0d0;
    --brasa:#9a1408; --brasa-ink:#7a1206; --brasa-wash:#f4ddd0;
    --oliva:#4f5d2d; --oliva-wash:#eef3e0;
    --shadow:none;
  }
  html,body{ background:#fff !important; color:var(--ink) !important; }
  body{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .wrap{ max-width:none; padding:0; }
  .hero{ padding-top:0; }
  .paso, details, .ej, .qa{ break-inside:avoid; box-shadow:none; }
  .faq > h2{ break-after:avoid; }
  .pill.on{ color:#fff !important; }
  summary{ cursor:default; }
  summary::after{ display:none !important; }
  details[open] summary{ border-bottom:1px solid var(--rule-soft); }
  a{ color:var(--brasa-ink); text-decoration:none; }
}
"""
src = src.replace("</style>", print_css + "</style>", 1)
# color-scheme meta al head, por si el visor de PDF respeta esquema
src = src.replace("<title>", '<meta name="color-scheme" content="light">\n<title>', 1)

(d / "guia-reportes-print.html").write_text(src, encoding="utf-8")
print("ok  guia-reportes-print.html", len(src), "chars")
