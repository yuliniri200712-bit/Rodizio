/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   El corazón de la confirmación de pago: dado un order_number y el
   monto que DEBERÍA valer ese pedido (ya recalculado con
   calcularTotal.js, nunca el que mandó el navegador), decide si
   AAvance de verdad lo cobró bien.

   No alcanza con mirar si la transacción quedó "Aprobada"
   (idstatus 34) — hay que comparar también el monto, porque el
   botón de pago es un <form> que viaja por el navegador del
   cliente y en teoría se puede alterar (ver
   docs-fusion/PLAN-PASARELA-PAGO.md, "Decisión 2026-09-23: botón
   de pago vs link de pago"). Sin esta comparación, alguien podría
   pagar $1 por un pedido de $50.000 y quedar igual marcado como
   pagado.
   ========================================================= */

const { consultarTransaccion } = require('./consultarTransaccionAAvance');

const ESTADO_APROBADO = 34;

/**
 * @param {string} externalOrder - el order_number del pedido.
 * @param {number} montoEsperado - el total recalculado en servidor (COP).
 * @returns {{
 *   pagoValido: boolean,
 *   motivo: string,
 *   idstatus: number|null,
 *   idstatusNombre: string|null,
 *   montoCobrado: number|null,
 *   montoEsperado: number,
 *   transaccion: object|null,
 * }}
 */
async function verificarPago(externalOrder, montoEsperado) {
  const transaccion = await consultarTransaccion(externalOrder);

  if (!transaccion) {
    return {
      pagoValido: false,
      motivo: `No existe ninguna transacción de AAvance con order_number "${externalOrder}".`,
      idstatus: null,
      idstatusNombre: null,
      montoCobrado: null,
      montoEsperado,
      transaccion: null,
    };
  }

  const idstatus = transaccion.idstatus?.id ?? null;
  const idstatusNombre = transaccion.idstatus?.nombre ?? null;
  const montoCobrado = transaccion.amount ?? null;

  if (idstatus !== ESTADO_APROBADO) {
    return {
      pagoValido: false,
      motivo: `La transacción no está aprobada (idstatus ${idstatus} = "${idstatusNombre}").`,
      idstatus,
      idstatusNombre,
      montoCobrado,
      montoEsperado,
      transaccion,
    };
  }

  if (montoCobrado !== montoEsperado) {
    return {
      pagoValido: false,
      motivo: `El monto cobrado ($${montoCobrado}) no coincide con el total real del pedido ($${montoEsperado}) — posible manipulación del formulario.`,
      idstatus,
      idstatusNombre,
      montoCobrado,
      montoEsperado,
      transaccion,
    };
  }

  return {
    pagoValido: true,
    motivo: 'Aprobada y el monto coincide con el total real del pedido.',
    idstatus,
    idstatusNombre,
    montoCobrado,
    montoEsperado,
    transaccion,
  };
}

module.exports = { verificarPago, ESTADO_APROBADO };
