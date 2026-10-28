/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   Recalcula el total de un pedido a partir de los precios REALES
   guardados en Firebase — nunca confía en el precio que manda el
   navegador del cliente. Ver docs-fusion/PLAN-PASARELA-PAGO.md
   sección 2 (el hallazgo de seguridad más viejo del proyecto:
   auth.js hoy guarda subtotal/shipping/total tal como los manda
   el navegador).

   Corre como función pura de Node, SIN firebase-admin ni ninguna
   credencial: "products"/"productsMesa" tienen `.read: true` en
   database.rules.json (el menú es público a propósito), así que
   alcanza con la REST API pública, igual que hace el resto de la
   app (ver tienda/CLAUDE.md, "Arquitectura de datos"). Cuando se
   pague el plan Blaze, esta misma función se importa tal cual
   dentro de la Cloud Function real — no hay que reescribirla,
   solo conectarla.
   ========================================================= */

const DB_URL = 'https://rodiziomarketplace-default-rtdb.firebaseio.com';

async function obtenerPrecios(origen) {
  const nodo = origen === 'mesa' ? 'productsMesa' : 'products';
  const res = await fetch(`${DB_URL}/${nodo}.json`);
  if (!res.ok) throw new Error(`No se pudo leer ${nodo} de Firebase (HTTP ${res.status})`);
  return (await res.json()) || {};
}

/**
 * items: [{ id, qty }] — el precio y el nombre que mande el cliente
 * se IGNORAN a propósito, solo importan el id (qué producto) y la
 * cantidad. El precio real siempre sale de Firebase.
 * origen: 'domicilio' | 'recoger' | 'mesa' (decide products vs productsMesa).
 *
 * Devuelve { subtotal, lineas, problemas } — problemas es un array de
 * texto (producto inexistente, oculto, cantidad inválida); si tiene
 * algo, el pedido NO debería aceptarse tal cual vino.
 */
async function calcularSubtotalPedido(items, origen = 'domicilio') {
  const precios = await obtenerPrecios(origen);
  const lineas = [];
  const problemas = [];

  for (const { id, qty } of items) {
    const producto = precios[id];
    if (!producto) {
      problemas.push(`El producto "${id}" no existe.`);
      continue;
    }
    if (producto.hidden) {
      problemas.push(`"${producto.name || id}" ya no está disponible.`);
      continue;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      problemas.push(`Cantidad inválida para "${producto.name || id}": ${qty}`);
      continue;
    }
    const importe = producto.price * qty;
    lineas.push({ id, name: producto.name, price: producto.price, qty, importe });
  }

  const subtotal = lineas.reduce((sum, l) => sum + l.importe, 0);
  return { subtotal, lineas, problemas };
}

module.exports = { calcularSubtotalPedido, obtenerPrecios, DB_URL };
