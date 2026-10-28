/* ═══════════════════════════════════════════════════════════════
   Rodizio · panel-cliente — Internacionalización (i18n)
   Permite al cliente cambiar entre español e inglés.
   Solo traduce la UI (botones, títulos, etiquetas), NO los
   nombres de platos que vienen de Firebase.
   ═══════════════════════════════════════════════════════════════ */


const STRINGS = {
  es: {
    heroSub: 'Elige tus platos y envíalos al mesero — él revisa y confirma tu pedido antes de mandarlo a cocina.',
    searchPlaceholder: 'Buscar producto…',
    noResults: 'No se encontraron productos con',
    categories: 'Categorías',
    tuPedido: 'Tu pedido',
    nombreOpcional: 'Tu nombre (opcional)',
    notaCocina: 'Nota para cocina (opcional)',
    total: 'Total',
    vaciar: 'Vaciar',
    enviarPedido: 'Enviar pedido al mesero',
    enviando: 'Enviando…',
    pedidoEnviado: 'Pedido enviado',
    pedidoEnviadoDesc: 'Tu pedido fue enviado — el mesero lo va a revisar y confirmar en breve para mandarlo a cocina.',
    pedidoEnviadoToast: 'Pedido enviado — el mesero lo va a confirmar',
    pedidoEnviadoBanner: 'Pedido enviado — el mesero lo va a confirmar',
    volverMenu: '← Volver al menú',
    verPedido: 'Ver pedido',
    item: 'ítem',
    items: 'ítems',
    enlaceNoValido: 'Enlace no válido',
    enlaceNoValidoDesc: 'Este enlace no corresponde a ninguna mesa. Pide ayuda al mesero para escanear el código correcto.',
    cargandoMenu: 'Cargando el menú…',
    personalizaPedido: 'Personaliza tu pedido',
    otraIndicacion: 'Otra indicación (opcional)',
    pedidoVacio: 'Tu pedido está vacío',
    avisoDatos: 'Si escribes tu nombre, lo usamos solo para identificar tu pedido en cocina — no se comparte con terceros.',
    masInfo: 'Más información',
    entendido: 'Entendido',
    cerrarDetalle: 'Cerrar detalle',
    verCategorias: 'Ver categorías del menú',
  },
  en: {
    heroSub: 'Choose your dishes and send them to the waiter — they will review and confirm your order before sending it to the kitchen.',
    searchPlaceholder: 'Search product…',
    noResults: 'No products found with',
    categories: 'Categories',
    tuPedido: 'Your order',
    nombreOpcional: 'Your name (optional)',
    notaCocina: 'Note for kitchen (optional)',
    total: 'Total',
    vaciar: 'Clear',
    enviarPedido: 'Send order to waiter',
    enviando: 'Sending…',
    pedidoEnviado: 'Order sent',
    pedidoEnviadoDesc: 'Your order has been sent — the waiter will review and confirm it shortly before sending it to the kitchen.',
    pedidoEnviadoToast: 'Order sent — the waiter will confirm it',
    pedidoEnviadoBanner: 'Order sent — the waiter will confirm it',
    volverMenu: '← Back to menu',
    verPedido: 'View order',
    item: 'item',
    items: 'items',
    enlaceNoValido: 'Invalid link',
    enlaceNoValidoDesc: 'This link does not match any table. Ask the waiter for help to scan the correct code.',
    cargandoMenu: 'Loading menu…',
    personalizaPedido: 'Customize your order',
    otraIndicacion: 'Other instructions (optional)',
    pedidoVacio: 'Your order is empty',
    avisoDatos: 'If you enter your name, we only use it to identify your order in the kitchen — it is not shared with third parties.',
    masInfo: 'More info',
    entendido: 'Got it',
    cerrarDetalle: 'Close details',
    verCategorias: 'View menu categories',
  },
};

/* SIEMPRE arranca en español, a pedido del usuario: cada cliente que
   escanea el QR de una mesa es una persona distinta, así que heredar el
   idioma que eligió el comensal anterior en ese mismo celular no tiene
   sentido. El cambio a inglés dura lo que dure la visita y no se guarda. */
let currentLang = 'es';

function t(key) {
  return (STRINGS[currentLang] || STRINGS.es)[key] || (STRINGS.es)[key] || key;
}

function getLang() {
  return currentLang;
}

function setLang(lang) {
  if (lang !== 'es' && lang !== 'en') return;
  currentLang = lang;
}

// Exponer globalmente para que app.js (script clásico) pueda usarlo
window.t = t;
window.getLang = getLang;
window.setLang = setLang;
