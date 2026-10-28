/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* ─────────────────────────────────────────────────────────────
   Reportes → "Descargar Excel" (panel-admin)

   Un .xlsx detallado del rango y filtros GLOBALES del dashboard
   (rango de fechas, canal y persona). TODOS los números salen de la
   capa de reportes de shared/util.js — los mismos que muestra el
   dashboard y el Excel de caja, nunca una fórmula propia.

   Hojas:
     Resumen        KPIs, comparación con el periodo anterior, canales,
                    métodos de pago, tiempos, cancelaciones y anulaciones
     Pedidos        un renglón por pedido (incluye cancelados), con
                    tiempos de cocina/entrega y quién hizo qué
     Ítems          un renglón por plato vendido en cada pedido
     Platos         ranking por unidades
     Categorías     venta por categoría
     Por día        tendencia diaria
     Por hora       demanda por franja horaria
     Equipo         meseros, cajeros y domiciliarios
     Cancelaciones  cancelados y no entregados con su motivo
     Anulaciones    cobros anulados en caja (quién, cuándo, por qué)

   ExcelJS se carga recién al pedir el archivo (no pesa en cada visita).
   ───────────────────────────────────────────────────────────── */
(function (global) {
  const EXCELJS_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
  let cargaExcelJS = null;
  function cargarExcelJS() {
    if (global.ExcelJS) return Promise.resolve(global.ExcelJS);
    if (!cargaExcelJS) {
      cargaExcelJS = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = EXCELJS_URL;
        s.onload = () => resolve(global.ExcelJS);
        s.onerror = () => { cargaExcelJS = null; reject(new Error("No se pudo cargar ExcelJS")); };
        document.head.appendChild(s);
      });
    }
    return cargaExcelJS;
  }

  // Paleta "Rodízio Brasa" (shared/marca.css), en ARGB. Las claves conservan
  // sus nombres para no tocar el resto del archivo: "obsidiana" es el carbón.
  const C = {
    obsidiana: "FF2A2D33",
    rojo: "FFB52A20",
    blanco: "FFFFFFFF",
    zebra: "FFF7F6F3",
    borde: "FFD3CFC8",
    gris: "FF56595F",
    total: "FFE3E0DA",
  };
  const MONEDA = '"$"#,##0';
  const ENTERO = "#,##0";
  const CANAL = { mesa: "Mesa", domicilio: "Domicilio", recoger: "Recoger en tienda" };
  const METODO = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", en_linea: "En línea" };
  const ESTADO = {
    recibido: "Recibido", enviado: "Confirmado", preparacion: "En cocina", listo: "Listo",
    en_camino: "En camino", llegado: "Llegando", entregado: "Entregado",
    no_entregado: "No entregado", cancelado: "Cancelado",
  };

  const fecha = (ms) => (ms ? fmtFechaCO(ms, { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
  const hora = (ms) => (ms ? fmtHoraCO(ms) : "");

  // Hoja con encabezado oscuro fijo, filtros, bordes suaves y zebra.
  function hojaTabla(wb, nombre, columnas, filas, opts) {
    const o = opts || {};
    const ws = wb.addWorksheet(nombre, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = columnas.map((c) => ({ header: c.h, key: c.k, width: c.w || 14 }));
    filas.forEach((f) => ws.addRow(f));

    const head = ws.getRow(1);
    head.height = 22;
    head.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: C.blanco } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.obsidiana } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    columnas.forEach((c) => {
      const col = ws.getColumn(c.k);
      if (c.fmt) col.numFmt = c.fmt;
      if (c.wrap) col.alignment = { wrapText: true, vertical: "top" };
    });
    ws.eachRow((row, n) => {
      if (n === 1) return;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { bottom: { style: "thin", color: { argb: C.borde } } };
        if (n % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.zebra } };
        if (!cell.alignment) cell.alignment = { vertical: "top" };
      });
    });
    if (filas.length) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
    }
    if (o.totales && filas.length) {
      const fila = ws.addRow(o.totales);
      fila.font = { bold: true };
      fila.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.total } };
        cell.border = { top: { style: "medium", color: { argb: C.obsidiana } } };
      });
    }
    // Aviso en la primera columna (por clave, como el resto de filas).
    if (!filas.length) ws.addRow({ [columnas[0].k]: o.vacio || "Sin datos en este rango." }).font = { italic: true, color: { argb: C.gris } };
    return ws;
  }

  function hojaResumen(wb, ctx) {
    const { ventas, ventasAnt, canales, tiempos, tasas, anulaciones, rango, filtrosTexto, generado } = ctx;
    const ws = wb.addWorksheet("Resumen");
    // Hoja de texto libre (no tabla): solo se fijan los anchos.
    [34, 18, 18, 18, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    ws.mergeCells("A1:E1");
    ws.getCell("A1").value = "Rodízio Cúcuta — Reporte de ventas";
    ws.getCell("A1").font = { bold: true, size: 16, color: { argb: C.blanco } };
    ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.obsidiana } };
    ws.getRow(1).height = 30;
    ws.getCell("A1").alignment = { vertical: "middle", indent: 1 };
    ws.mergeCells("A2:E2");
    ws.getCell("A2").value = `Periodo: ${rango.label} (${fecha(rango.desde)} a ${fecha(rango.hasta)}) · ${filtrosTexto} · Generado ${generado}`;
    ws.getCell("A2").font = { color: { argb: C.gris }, size: 10 };
    ws.addRow([]);

    const seccion = (titulo) => {
      const r = ws.addRow([titulo]);
      r.font = { bold: true, color: { argb: C.rojo }, size: 12 };
      r.getCell(1).border = { bottom: { style: "medium", color: { argb: C.rojo } } };
    };
    const fila = (label, valores, fmt) => {
      const r = ws.addRow([label].concat(valores));
      for (let i = 2; i <= valores.length + 1; i++) if (fmt) r.getCell(i).numFmt = fmt;
      return r;
    };
    const delta = (a, b) => { const v = variacionPct(a, b); return v === null ? "—" : (v >= 0 ? "+" : "") + v + "%"; };

    seccion("Ventas (solo lo cobrado)");
    const hc = ws.addRow(["", "Este periodo", "Periodo anterior", "Variación"]);
    hc.font = { bold: true, color: { argb: C.gris } };
    fila("Venta cobrada", [ventas.total, ventasAnt.total], MONEDA).getCell(4).value = delta(ventas.total, ventasAnt.total);
    fila("Pedidos cobrados", [ventas.pedidos, ventasAnt.pedidos], ENTERO).getCell(4).value = delta(ventas.pedidos, ventasAnt.pedidos);
    fila("Ticket promedio", [ventas.ticketPromedio, ventasAnt.ticketPromedio], MONEDA).getCell(4).value = delta(ventas.ticketPromedio, ventasAnt.ticketPromedio);
    fila("Unidades vendidas", [ventas.unidades, ventasAnt.unidades], ENTERO);
    fila("Ítems por pedido", [ventas.itemsPorPedido, ventasAnt.itemsPorPedido]);
    fila("Cobrado en envíos", [ventas.envios, ventasAnt.envios], MONEDA);
    fila("Propinas", [ventas.propinas, ventasAnt.propinas], MONEDA);
    ws.addRow([]);

    seccion("Por canal");
    ws.addRow(["", "Venta", "Pedidos", "Ticket promedio"]).font = { bold: true, color: { argb: C.gris } };
    ["mesa", "domicilio", "recoger"].forEach((k) => {
      const c = canales[k];
      const r = ws.addRow([CANAL[k], c.total, c.pedidos, c.ticketPromedio]);
      r.getCell(2).numFmt = MONEDA; r.getCell(4).numFmt = MONEDA;
    });
    ws.addRow([]);

    seccion("Por método de pago");
    Object.entries(METODO).forEach(([k, label]) => fila(label, [ventas.porMetodo[k] || 0], MONEDA));
    if (ventas.porMetodo.otro) fila("Sin método registrado", [ventas.porMetodo.otro], MONEDA);
    ws.addRow([]);

    seccion("Tiempos (minutos, pedidos no cancelados)");
    ws.addRow(["", "Mediana", "Promedio", "Mínimo – máximo", "Pedidos medidos"]).font = { bold: true, color: { argb: C.gris } };
    [["Cocina (confirmado → listo)", "cocina"], ["Entrega (en camino → entregado)", "entrega"],
     ["Caja confirma (domicilio)", "confirmacion"], ["Total (creado → entregado)", "total"]].forEach(([label, k]) => {
      const d = tiempos.detalle[k];
      ws.addRow([label, d.mediana ?? "—", d.prom ?? "—", d.n ? `${d.min} – ${d.max}` : "—", d.n]);
    });
    ws.addRow(["Entregados a tiempo vs. estimado", tiempos.pctATiempo === null ? "—" : tiempos.pctATiempo + "%", "", "", tiempos.muestrasEta]);
    ws.addRow([]);

    seccion("Incidencias");
    ws.addRow(["Pedidos cancelados", tasas.cancelados, tasas.pctCancelados + "% del total"]);
    ws.addRow(["No entregados", tasas.noEntregados, tasas.pctNoEntregados + "% del total"]);
    const montoAnulado = anulaciones.reduce((s, a) => s + (a.monto || 0), 0);
    const ra = ws.addRow(["Cobros anulados en caja", anulaciones.length, montoAnulado]);
    ra.getCell(3).numFmt = MONEDA;
    ws.addRow([]);
    const nota = ws.addRow(["La plata solo cuenta lo que caja marcó como cobrado. Un cobro anulado deja de sumar y queda en la hoja \"Anulaciones\"."]);
    nota.font = { italic: true, color: { argb: C.gris }, size: 9 };
    ws.mergeCells(`A${nota.number}:E${nota.number}`);
  }

  /* opts: { entries: [[id, pedido]...], rangoClave, rangoDia, rangoMes,
             origen, persona } — los mismos filtros globales del dashboard. */
  async function descargarReporteExcel(opts) {
    const ExcelJS = await cargarExcelJS();
    const rango = rangoReporte(opts.rangoClave, { dia: opts.rangoDia, mes: opts.rangoMes });
    const base = { origen: opts.origen || "", persona: opts.persona || "" };
    const entries = opts.entries || [];
    const cortar = (extra, r) => filtrarPedidos(entries, Object.assign({}, base,
      { desde: (r || rango).desde, hasta: (r || rango).hasta }, extra || {}));

    const pagados = cortar({ soloPagados: true });
    const operativos = cortar();
    const todos = cortar({ incluirCancelados: true });
    const pagadosAnt = cortar({ soloPagados: true }, { desde: rango.desdeAnterior, hasta: rango.hastaAnterior });

    // Las anulaciones se fechan por CUÁNDO se anuló, no por el pedido.
    const anulaciones = [];
    filtrarPedidos(entries, Object.assign({}, base, { incluirCancelados: true })).forEach(([id, p]) => {
      Object.values(p.anulaciones || {}).forEach((a) => {
        if (a && a.ts >= rango.desde && a.ts <= rango.hasta) anulaciones.push(Object.assign({ id, p }, a));
      });
    });
    anulaciones.sort((a, b) => a.ts - b.ts);

    const filtrosTexto = [
      base.origen ? "Canal: " + CANAL[base.origen] : "Todos los canales",
      base.persona ? "Persona: " + base.persona : "Todo el equipo",
    ].join(" · ");
    const generado = fmtFechaCO(Date.now(), { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + fmtHoraCO(Date.now());

    const wb = new ExcelJS.Workbook();
    wb.creator = "Rodízio Cúcuta";
    wb.created = new Date();

    const ventas = resumenVentas(pagados);
    hojaResumen(wb, {
      ventas, ventasAnt: resumenVentas(pagadosAnt), canales: resumenCanales(pagados),
      tiempos: tiemposOperacion(operativos), tasas: tasasIncidencia(todos),
      anulaciones, rango, filtrosTexto, generado,
    });

    // ── Pedidos ──
    const ordenados = todos.slice().sort((a, b) => tsDe(a[1]) - tsDe(b[1]));
    const filasPedidos = ordenados.map(([id, p]) => {
      const t = tiemposDePedido(p);
      const o = origenDe(p);
      const items = (p.lineas || []).map((l) => `${l.qty}× ${nombreLinea(l)}${notaLinea(l) ? " (" + notaLinea(l) + ")" : ""}`).join("\n");
      return {
        fecha: fecha(tsDe(p)), hora: hora(tsDe(p)), codigo: codigoPedido(p, id), canal: CANAL[o] || o,
        donde: o === "mesa" ? (p.mesa || "") : (p.customerName || p.cliente || ""),
        telefono: p.phone || "", direccion: o === "domicilio" ? (p.address || "") : "",
        estado: ESTADO[statusDe(p)] || statusDe(p),
        cobrado: p.pagado === true ? "Sí" : "No", metodo: METODO[p.metodoPago] || "",
        subtotal: p.subtotal != null ? p.subtotal : (p.total || 0) - (p.shipping || 0),
        envio: p.shipping || 0, propina: p.tipAmount || 0, total: p.total || 0,
        horaPago: hora(p.tsPago), mesero: p.mesero || "", cajero: p.cajero || "",
        domiciliario: p.driverName || "", confirmo: p.confirmadoPor || "",
        minCocina: t.cocina, minEntrega: t.entrega, minTotal: t.total,
        items, motivo: p.motivoCancelacion || p.deliveryFailureReason || "",
        anulaciones: Object.keys(p.anulaciones || {}).length || "",
      };
    });
    const cobradosLista = filasPedidos.filter((f) => f.cobrado === "Sí");
    hojaTabla(wb, "Pedidos", [
      { h: "Fecha", k: "fecha", w: 11 }, { h: "Hora", k: "hora", w: 9 }, { h: "Código", k: "codigo", w: 10 },
      { h: "Canal", k: "canal", w: 16 }, { h: "Mesa / Cliente", k: "donde", w: 20 }, { h: "Teléfono", k: "telefono", w: 13 },
      { h: "Dirección", k: "direccion", w: 28, wrap: true }, { h: "Estado", k: "estado", w: 13 },
      { h: "Cobrado", k: "cobrado", w: 9 }, { h: "Método", k: "metodo", w: 14 },
      { h: "Subtotal", k: "subtotal", w: 12, fmt: MONEDA }, { h: "Envío", k: "envio", w: 10, fmt: MONEDA },
      { h: "Propina", k: "propina", w: 10, fmt: MONEDA }, { h: "Total", k: "total", w: 12, fmt: MONEDA },
      { h: "Hora de pago", k: "horaPago", w: 11 }, { h: "Mesero", k: "mesero", w: 14 }, { h: "Cajero", k: "cajero", w: 14 },
      { h: "Domiciliario", k: "domiciliario", w: 16 }, { h: "Confirmó (domicilio)", k: "confirmo", w: 22 },
      { h: "Min. cocina", k: "minCocina", w: 10 }, { h: "Min. entrega", k: "minEntrega", w: 11 }, { h: "Min. total", k: "minTotal", w: 10 },
      { h: "Productos", k: "items", w: 40, wrap: true }, { h: "Motivo cancelación / no entrega", k: "motivo", w: 30, wrap: true },
      { h: "Cobros anulados", k: "anulaciones", w: 10 },
    ], filasPedidos, {
      totales: { fecha: "TOTAL COBRADO", codigo: `${cobradosLista.length} ped.`, total: ventas.total, envio: ventas.envios, propina: ventas.propinas },
      vacio: "No hay pedidos en este rango.",
    });

    // ── Ítems ──
    const filasItems = [];
    ordenados.forEach(([id, p]) => {
      (p.lineas || []).forEach((l) => {
        filasItems.push({
          fecha: fecha(tsDe(p)), codigo: codigoPedido(p, id), canal: CANAL[origenDe(p)] || "",
          plato: l.id || "", nombre: nombreLinea(l), cat: l.cat || "", qty: l.qty || 0,
          precio: precioLinea(l), importe: precioLinea(l) * (l.qty || 0), nota: notaLinea(l),
          estado: ESTADO[statusDe(p)] || statusDe(p), cobrado: p.pagado === true ? "Sí" : "No",
        });
      });
    });
    hojaTabla(wb, "Ítems", [
      { h: "Fecha", k: "fecha", w: 11 }, { h: "Pedido", k: "codigo", w: 10 }, { h: "Canal", k: "canal", w: 16 },
      { h: "Código plato", k: "plato", w: 12 }, { h: "Plato", k: "nombre", w: 30 }, { h: "Categoría", k: "cat", w: 16 },
      { h: "Cantidad", k: "qty", w: 9, fmt: ENTERO }, { h: "Precio unitario", k: "precio", w: 13, fmt: MONEDA },
      { h: "Importe", k: "importe", w: 12, fmt: MONEDA }, { h: "Nota", k: "nota", w: 28, wrap: true },
      { h: "Estado del pedido", k: "estado", w: 14 }, { h: "Cobrado", k: "cobrado", w: 9 },
    ], filasItems);

    // ── Platos y categorías (solo cobrado) ──
    const platos = ventasPorPlato(pagados).sort((a, b) => b.cantidad - a.cantidad);
    hojaTabla(wb, "Platos", [
      { h: "#", k: "pos", w: 5 }, { h: "Código", k: "codigo", w: 12 }, { h: "Plato", k: "nombre", w: 32 },
      { h: "Unidades", k: "cantidad", w: 10, fmt: ENTERO }, { h: "Venta", k: "total", w: 14, fmt: MONEDA },
      { h: "% de la venta", k: "pct", w: 12 },
    ], platos.map((f, i) => ({ pos: i + 1, codigo: f.codigo, nombre: f.nombre, cantidad: f.cantidad, total: f.total,
      pct: ventas.total ? Math.round((f.total / ventas.total) * 1000) / 10 + "%" : "" })),
    { totales: { nombre: "TOTAL", cantidad: platos.reduce((s, f) => s + f.cantidad, 0), total: platos.reduce((s, f) => s + f.total, 0) } });

    const cats = ventasPorCategoria(pagados);
    hojaTabla(wb, "Categorías", [
      { h: "Categoría", k: "cat", w: 24 }, { h: "Unidades", k: "cantidad", w: 10, fmt: ENTERO }, { h: "Venta", k: "total", w: 14, fmt: MONEDA },
    ], cats);

    // ── Por día / por hora ──
    hojaTabla(wb, "Por día", [
      { h: "Día", k: "fecha", w: 14 }, { h: "Pedidos cobrados", k: "pedidos", w: 14, fmt: ENTERO }, { h: "Venta", k: "total", w: 14, fmt: MONEDA },
    ], serieDiaria(pagados, rango.desde, rango.hasta).map((d) => ({ fecha: fecha(d.ts), pedidos: d.pedidos, total: d.total })),
    { totales: { fecha: "TOTAL", pedidos: ventas.pedidos, total: ventas.total } });

    hojaTabla(wb, "Por hora", [
      { h: "Hora", k: "label", w: 10 }, { h: "Pedidos (no cancelados)", k: "pedidos", w: 20, fmt: ENTERO }, { h: "Venta", k: "total", w: 14, fmt: MONEDA },
    ], bucketsPorHora(operativos).filter((h) => h.pedidos > 0));

    // ── Equipo ──
    const equipo = [];
    [["Mesero", "mesero"], ["Cajero", "cajero"], ["Domiciliario", "driverName"]].forEach(([rol, campo]) => {
      resumenPersonas(pagados, campo).forEach((r) => equipo.push(Object.assign({ rol }, r)));
    });
    hojaTabla(wb, "Equipo", [
      { h: "Rol", k: "rol", w: 14 }, { h: "Nombre", k: "nombre", w: 20 }, { h: "Pedidos", k: "pedidos", w: 10, fmt: ENTERO },
      { h: "Venta", k: "total", w: 14, fmt: MONEDA }, { h: "Ticket promedio", k: "ticketPromedio", w: 14, fmt: MONEDA },
      { h: "Unidades", k: "unidades", w: 10, fmt: ENTERO }, { h: "Propinas", k: "propinas", w: 12, fmt: MONEDA },
    ], equipo);

    // ── Cancelaciones ──
    const incidencias = ordenados.filter(([, p]) => ["cancelado", "no_entregado"].includes(statusDe(p))).map(([id, p]) => ({
      fecha: fecha(tsDe(p)), hora: hora(p.tsCancelado || p.deliveryFailureAt || p.tsCambio || tsDe(p)),
      codigo: codigoPedido(p, id), canal: CANAL[origenDe(p)] || "", estado: ESTADO[statusDe(p)],
      total: p.total || 0, motivo: p.motivoCancelacion || p.deliveryFailureReason || "Sin motivo",
      por: p.canceladoPor || p.driverName || "",
    }));
    hojaTabla(wb, "Cancelaciones", [
      { h: "Fecha", k: "fecha", w: 11 }, { h: "Hora", k: "hora", w: 9 }, { h: "Código", k: "codigo", w: 10 },
      { h: "Canal", k: "canal", w: 16 }, { h: "Estado", k: "estado", w: 13 }, { h: "Total", k: "total", w: 12, fmt: MONEDA },
      { h: "Motivo", k: "motivo", w: 36, wrap: true }, { h: "Cancelado por", k: "por", w: 22 },
    ], incidencias, { vacio: "No hubo cancelaciones ni pedidos sin entregar en este rango." });

    // ── Anulaciones de cobro ──
    hojaTabla(wb, "Anulaciones", [
      { h: "Fecha", k: "fecha", w: 11 }, { h: "Hora", k: "hora", w: 9 }, { h: "Pedido", k: "codigo", w: 10 },
      { h: "Canal", k: "canal", w: 16 }, { h: "Monto", k: "monto", w: 12, fmt: MONEDA }, { h: "Método anulado", k: "metodo", w: 14 },
      { h: "Cobrado por", k: "cobradoPor", w: 16 }, { h: "Anulado por", k: "anuladoPor", w: 16 }, { h: "Motivo", k: "motivo", w: 40, wrap: true },
    ], anulaciones.map((a) => ({
      fecha: fecha(a.ts), hora: hora(a.ts), codigo: codigoPedido(a.p, a.id), canal: CANAL[origenDe(a.p)] || "",
      monto: a.monto || 0, metodo: METODO[a.metodoPago] || "", cobradoPor: a.cobradoPor || "",
      anuladoPor: a.anuladoPor || "", motivo: a.motivo || "",
    })), { vacio: "No se anuló ningún cobro en este rango." });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rodizio-reporte-${isoDiaCO(rango.desde)}_a_${isoDiaCO(rango.hasta)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { pedidos: filasPedidos.length, items: filasItems.length, anulaciones: anulaciones.length };
  }

  global.descargarReporteExcel = descargarReporteExcel;
})(window);
