/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* ─────────────────────────────────────────────────────────────
   Rodizio Admin · Reportes — app de Vue 3 (build global por CDN,
   sin build/npm) montada en #vistaDashboard.

   Vive separada del resto de panel-admin (app.js, imperativo con
   getElementById) para no mezclar dos estilos de código en el mismo
   archivo — ver plan "Dashboard de reportes en panel-admin".

   TODOS los cálculos viven en la capa de reportes de shared/util.js
   (fase R1, ver docs-fusion/PLAN-REPORTES.md) — este archivo solo
   arma la vista. Así el Excel de panel-caja, este dashboard y los
   reportes de la tienda dan siempre el mismo número, sin tres
   fórmulas distintas que se van desincronizando.

   Filtros GLOBALES (afectan todo): rango de fechas, canal
   (mesa/domicilio/recoger) y persona (mesero, cajero o domiciliario —
   un solo selector, filtrarPedidos() matchea los tres campos).
   "Top platos" tiene además su buscador por código, que es propio de
   esa tabla y no tiene sentido aplicar al resto.

   Regla del dinero: la plata solo cuenta si caja marcó `pagado`
   (mesa + domicilio + recoger). Los conteos y tiempos operativos usan
   todos los pedidos no cancelados — un pedido que se preparó y no se
   cobró igual ocupó la cocina. ── */
(function () {
  const { createApp, ref, computed, watch, onMounted } = Vue;

  const charts = {}; // id -> instancia de Chart.js (se reusan, no se recrean)

  // Colores de los gráficos = tokens de shared/marca.css (Chart.js pinta en
  // canvas y no entiende var(--…), así que se leen una vez al cargar).
  const tokenCSS = (n, def) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || def;
  const COLOR_ACCENT = tokenCSS("--marca", "#B52A20");
  const COLOR_RELLENO = tokenCSS("--marca-tinte", "#F4DEDA");
  const COLOR_VERDE = tokenCSS("--exito", "#2E6E47");
  const COLOR_AZUL = tokenCSS("--info", "#2C5A80");

  const RANGOS = [
    { clave: "hoy", label: "Hoy" },
    { clave: "ayer", label: "Ayer" },
    { clave: "7d", label: "Últimos 7 días" },
    { clave: "30d", label: "Últimos 30 días" },
    { clave: "mes", label: "Este mes" },
    { clave: "mesPasado", label: "Mes pasado" },
    { clave: "dia", label: "Un día…" },
    { clave: "mesEspecifico", label: "Un mes…" },
  ];

  // El "hoy" por defecto de los selectores de día/mes es el de Colombia
  // (isoDiaCO en shared/util.js), no el del dispositivo.
  const hoyISO = () => isoDiaCO();

  function valoresUnicos(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  // Sube o reusa un gráfico. Chart.js no calcula bien el tamaño si el
  // contenedor está oculto (la pestaña Reportes arranca en display:none),
  // por eso además existe __dashboardOnShow más abajo.
  function pintar(id, canvas, config) {
    if (!canvas) return;

    // Un canvas detrás de un v-if (la línea de tendencia solo existe con
    // rango de más de un día) se desmonta y vuelve a montar como un
    // elemento NUEVO. La instancia vieja quedó apuntando al nodo viejo:
    // si no se limpia, al volver aparece un gráfico "fantasma" duplicado.
    // Chart.getChart() es la forma oficial de encontrar (y matar) lo que
    // haya quedado montado sobre este canvas concreto.
    const montado = Chart.getChart(canvas);
    if (charts[id] && charts[id] !== montado) { charts[id].destroy(); delete charts[id]; }
    if (montado && montado !== charts[id]) montado.destroy();

    if (charts[id]) {
      // SOLO se reemplazan los datos. NO tocar `chart.options`: Chart.js lo
      // convierte en una estructura interna con descriptores/proxies, y
      // pisarla con un objeto plano rompe la resolución de opciones
      // ("t.startsWith is not a function" al repintar). No hace falta:
      // las opciones de acá son fijas, y los callbacks de tooltip leen
      // `.value` de los computed en cada llamada, así que ya salen frescos.
      charts[id].data = config.data;
      charts[id].update();
      return;
    }
    charts[id] = new Chart(canvas, config);
  }

  const app = createApp({
    setup() {
      const pedidos = ref({});
      const rangoClave = ref("hoy");
      const rangoDia = ref(hoyISO());
      const rangoMes = ref(hoyISO().slice(0, 7));
      const filtroCanal = ref("");
      const filtroPersona = ref("");
      const filtroCategoria = ref("");
      const filtroCodigo = ref("");

      /* ── Filtros POR SECCIÓN ──────────────────────────────────────
         Cada sección puede seguir el filtro global (valor "") o tener el
         suyo propio: cualquiera de los rangos, o un día / mes concreto.
         Así se puede comparar, por ejemplo, las ventas del mes contra los
         tiempos de cocina de un día puntual, sin perder el contexto
         general de arriba. Mientras una sección esté independizada
         muestra un chip con su rango y un botón para volver al global. */
      const SECCIONES = ["ventas", "operacion", "productos", "equipo"];
      const secc = ref({});
      SECCIONES.forEach((s) => { secc.value[s] = { clave: "", dia: hoyISO(), mes: hoyISO().slice(0, 7) }; });

      // Rango efectivo de una sección: el suyo si eligió uno, si no el global.
      function rangoDe(seccion) {
        const s = secc.value[seccion];
        if (!s || !s.clave) return rango.value;
        return rangoReporte(s.clave, { dia: s.dia, mes: s.mes });
      }
      function propio(seccion) { return !!(secc.value[seccion] && secc.value[seccion].clave); }
      function volverAlGlobal(seccion) { secc.value[seccion].clave = ""; }

      // shared/firebase.js es un módulo ES y puede no haber corrido
      // todavía cuando este setup() de Vue se ejecuta — esperarFirebase()
      // (shared/util.js) espera a que window.escucharSSE exista.
      esperarFirebase().then(() => {
        escucharSSE("/orders", (data) => { pedidos.value = data || {}; });
      });

      const entries = computed(() => Object.entries(pedidos.value));
      const rango = computed(() => rangoReporte(rangoClave.value, { dia: rangoDia.value, mes: rangoMes.value }));
      const rangoLabel = computed(() => rango.value.label);

      // Un canal/persona elegido puede no existir en el rango nuevo —
      // resetear evita quedar en un filtro "fantasma" que no matchea nada.
      watch(rangoClave, () => { filtroPersona.value = ""; filtroCategoria.value = ""; filtroCodigo.value = ""; });

      const filtroBase = computed(() => ({
        origen: filtroCanal.value,
        persona: filtroPersona.value,
      }));

      // Tres universos distintos, a propósito:
      //  - pagados / pagadosAnt: la PLATA (y sus deltas).
      //  - operativos: todos los no cancelados — tiempos y demanda.
      //  - conCancelados: para poder calcular la TASA de cancelación.
      // Cada uno se recalcula CON EL RANGO DE SU SECCIÓN, no siempre con el
      // global (ver rangoDe()) — por eso son funciones y no constantes.
      const cortar = (r, extra) => filtrarPedidos(entries.value,
        Object.assign({}, filtroBase.value, { desde: r.desde, hasta: r.hasta }, extra || {}));

      // Titulares y KPIs de arriba: siempre el rango GLOBAL.
      const pagados = computed(() => cortar(rango.value, { soloPagados: true }));
      const pagadosAnt = computed(() => filtrarPedidos(entries.value,
        Object.assign({}, filtroBase.value, { desde: rango.value.desdeAnterior, hasta: rango.value.hastaAnterior, soloPagados: true })));

      const ventas = computed(() => resumenVentas(pagados.value));
      const ventasAnt = computed(() => resumenVentas(pagadosAnt.value));

      const deltaTotal = computed(() => variacionPct(ventas.value.total, ventasAnt.value.total));
      const deltaTicket = computed(() => variacionPct(ventas.value.ticketPromedio, ventasAnt.value.ticketPromedio));
      const deltaPedidos = computed(() => variacionPct(ventas.value.pedidos, ventasAnt.value.pedidos));

      // ── Por sección: cada una con su propio rango efectivo ──
      const rVentas = computed(() => rangoDe("ventas"));
      const rOperacion = computed(() => rangoDe("operacion"));
      const rProductos = computed(() => rangoDe("productos"));
      const rEquipo = computed(() => rangoDe("equipo"));

      const pagadosVentas = computed(() => cortar(rVentas.value, { soloPagados: true }));
      const pagadosProductos = computed(() => cortar(rProductos.value, { soloPagados: true }));
      const pagadosEquipo = computed(() => cortar(rEquipo.value, { soloPagados: true }));
      const operativos = computed(() => cortar(rOperacion.value));
      const conCancelados = computed(() => cortar(rOperacion.value, { incluirCancelados: true }));

      const tiempos = computed(() => tiemposOperacion(operativos.value));
      const tasas = computed(() => tasasIncidencia(conCancelados.value));
      const canales = computed(() => resumenCanales(pagadosVentas.value));
      const ventasSeccion = computed(() => resumenVentas(pagadosVentas.value));
      const serie = computed(() => serieDiaria(pagadosVentas.value, rVentas.value.desde, rVentas.value.hasta));
      const horas = computed(() => bucketsPorHora(operativos.value));
      const dias = computed(() => bucketsPorDiaSemana(operativos.value));
      const categorias = computed(() => ventasPorCategoria(pagadosProductos.value));

      const meseros = computed(() => resumenPersonas(pagadosEquipo.value, "mesero"));
      const cajeros = computed(() => resumenPersonas(pagadosEquipo.value, "cajero"));
      const domiciliarios = computed(() => resumenPersonas(pagadosEquipo.value, "driverName"));

      // Opciones de los selectores — salen del rango elegido, no de todo
      // el histórico, para no ofrecer gente que no trabajó ese día.
      const personasDisponibles = computed(() => valoresUnicos(
        filtrarPedidos(entries.value, { desde: rango.value.desde, hasta: rango.value.hasta })
          .flatMap(([, p]) => [p.mesero, p.cajero, p.driverName])
      ));
      const categoriasDisponibles = computed(() => valoresUnicos(pagadosProductos.value.flatMap(([, p]) => (p.lineas || []).map((l) => l.cat))));

      // ── Top platos (tabla + barras) ──
      const topPlatos = computed(() => {
        const base = filtroCategoria.value
          ? pagadosProductos.value.map(([id, p]) => [id, Object.assign({}, p, { lineas: (p.lineas || []).filter((l) => l.cat === filtroCategoria.value) })])
          : pagadosProductos.value;
        const todas = ventasPorPlato(base).sort((a, b) => b.cantidad - a.cantidad);
        const termino = filtroCodigo.value.trim().toLowerCase();
        // Con texto se quita el tope de 10: si no, no se podría encontrar un
        // plato que justo no esté entre los más vendidos.
        if (!termino) return todas.slice(0, 10);
        return todas.filter((f) => f.codigo.toLowerCase().includes(termino) || (f.nombre || "").toLowerCase().includes(termino));
      });
      const maxCantidad = computed(() => topPlatos.value.reduce((m, f) => Math.max(m, f.cantidad), 0) || 1);

      const hayDatos = computed(() => pagados.value.length > 0 || operativos.value.length > 0);

      // ── Canvas ──
      const cvLinea = ref(null), cvPlatos = ref(null), cvPago = ref(null);
      const cvCanal = ref(null), cvHora = ref(null), cvDia = ref(null), cvCategoria = ref(null);

      // Función, NO una constante compartida: Chart.js toma posesión del
      // objeto de opciones que recibe y le instala descriptores propios —
      // si tres gráficos comparten el mismo objeto `ticks`, el segundo
      // recibe uno ya envuelto y revienta ("t.startsWith is not a
      // function"). Cada gráfico necesita el suyo, recién creado.
      const ejeMoneda = () => ({ beginAtZero: true, ticks: { callback: (v) => fmtCop(v) } });

      function dibujarTodo() {
        // Tendencia de venta en el rango. Un solo día (Hoy/Ayer) no hace
        // línea: ahí el gráfico se oculta desde el template.
        pintar("linea", cvLinea.value, {
          type: "line",
          data: {
            labels: serie.value.map((p) => p.fecha),
            datasets: [{ label: "Venta cobrada", data: serie.value.map((p) => p.total), borderColor: COLOR_ACCENT, backgroundColor: COLOR_RELLENO, fill: true, tension: .3, pointRadius: 3 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtCop(c.parsed.y) + " · " + serie.value[c.dataIndex].pedidos + " pedido(s)" } } },
            scales: { y: ejeMoneda() },
          },
        });

        pintar("platos", cvPlatos.value, {
          type: "bar",
          data: { labels: topPlatos.value.map((d) => d.nombre), datasets: [{ label: "Unidades", data: topPlatos.value.map((d) => d.cantidad), backgroundColor: COLOR_ACCENT, borderRadius: 6 }] },
          options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
        });

        // Ahora con transferencia — antes la torta solo decía efectivo/tarjeta
        // aunque el sistema ya cobra por los tres métodos.
        const m = ventasSeccion.value.porMetodo;
        pintar("pago", cvPago.value, {
          type: "doughnut",
          data: { labels: ["Efectivo", "Tarjeta", "Transferencia"], datasets: [{ data: [m.efectivo, m.tarjeta, m.transferencia], backgroundColor: [COLOR_VERDE, COLOR_ACCENT, COLOR_AZUL] }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => c.label + ": " + fmtCop(c.parsed) } } } },
        });

        const c = canales.value;
        pintar("canal", cvCanal.value, {
          type: "bar",
          data: { labels: ["Mesa", "Domicilio", "Recoger"], datasets: [{ label: "Venta", data: [c.mesa.total, c.domicilio.total, c.recoger.total], backgroundColor: [COLOR_ACCENT, COLOR_AZUL, COLOR_VERDE], borderRadius: 6 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => fmtCop(ctx.parsed.y) } } }, scales: { y: ejeMoneda() } },
        });

        pintar("hora", cvHora.value, {
          type: "bar",
          data: { labels: horas.value.map((h) => h.label), datasets: [{ label: "Pedidos", data: horas.value.map((h) => h.pedidos), backgroundColor: COLOR_AZUL, borderRadius: 4 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
        });

        pintar("dia", cvDia.value, {
          type: "bar",
          data: { labels: dias.value.map((d) => d.label.slice(0, 3)), datasets: [{ label: "Pedidos", data: dias.value.map((d) => d.pedidos), backgroundColor: COLOR_VERDE, borderRadius: 4 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
        });

        pintar("categoria", cvCategoria.value, {
          type: "bar",
          data: { labels: categorias.value.map((x) => x.cat), datasets: [{ label: "Venta", data: categorias.value.map((x) => x.total), backgroundColor: COLOR_ACCENT, borderRadius: 6 }] },
          options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => fmtCop(ctx.parsed.x) } } }, scales: { x: ejeMoneda() } },
        });
      }

      onMounted(dibujarTodo);
      // flush:"post" es obligatorio acá: algunos canvas viven detrás de un
      // v-if (la línea de tendencia solo existe con rango de más de un día).
      // Con el flush "pre" por defecto el watcher corre ANTES de que Vue
      // actualice el DOM, así que el ref todavía sería null la primera vez
      // que el gráfico aparece y nunca se dibujaría.
      watch([serie, topPlatos, ventas, ventasSeccion, canales, horas, dias, categorias], dibujarTodo, { flush: "post" });

      // panel-admin/app.js llama a esto al mostrar la pestaña "Reportes"
      // (el div arranca con display:none — Chart.js no calcula bien el
      // tamaño del canvas mientras su contenedor está oculto).
      window.__dashboardOnShow = () => {
        dibujarTodo();
        Object.values(charts).forEach((ch) => { try { ch.resize(); } catch (e) { /* canvas ya desmontado */ } });
      };

      function minsLabel(n) { return n == null ? "—" : n + " min"; }

      // Texto honesto debajo de cada tiempo. Con pocos pedidos un solo caso
      // raro mueve el promedio, así que se dice cuántos se midieron y, si
      // promedio y mediana se separan mucho, se avisa del valor atípico —
      // es la diferencia entre un dato en el que confiar y uno que da
      // intriga sin saber por qué.
      function notaTiempo(stat) {
        if (!stat || !stat.n) return "Sin datos todavía";
        if (stat.n < MUESTRA_MINIMA_TIEMPOS) return "Poca muestra: solo " + stat.n + " pedido(s)";
        const desvio = stat.mediana ? Math.abs(stat.prom - stat.mediana) / stat.mediana : 0;
        // La cifra grande es la MEDIANA (lo normal); el promedio va acá solo si
        // un caso atípico lo infla — antes era al revés y la tarjeta decía
        // "Cocina 470 min" con una mediana de 3 (Fase 2, bug B7).
        if (desvio > 0.5) return stat.n + " pedidos · promedio " + stat.prom + " min por un caso atípico";
        return stat.n + " pedidos · entre " + stat.min + " y " + stat.max + " min";
      }
      // "Descargar Excel": los mismos filtros globales de arriba (rango,
      // canal, persona). La hoja la arma panel-admin/reporte-excel.js con
      // la misma capa de reportes de shared/util.js que usa esta vista.
      const generandoExcel = ref(false);
      async function descargarExcel() {
        if (generandoExcel.value) return;
        generandoExcel.value = true;
        try {
          await window.descargarReporteExcel({
            entries: entries.value,
            rangoClave: rangoClave.value, rangoDia: rangoDia.value, rangoMes: rangoMes.value,
            origen: filtroCanal.value, persona: filtroPersona.value,
          });
        } catch (e) {
          alert("No se pudo generar el Excel — revisa tu conexión e intenta de nuevo.");
        } finally {
          generandoExcel.value = false;
        }
      }

      function tiempoDudoso(stat) {
        return !stat || !stat.n || stat.n < MUESTRA_MINIMA_TIEMPOS;
      }

      return {
        RANGOS, rangoClave, rangoDia, rangoMes, rangoLabel,
        filtroCanal, filtroPersona, filtroCategoria, filtroCodigo,
        secc, propio, volverAlGlobal, rangoDe,
        rVentas, rOperacion, rProductos, rEquipo,
        personasDisponibles, categoriasDisponibles,
        ventas, ventasSeccion, deltaTotal, deltaTicket, deltaPedidos,
        tiempos, tasas, canales, topPlatos, maxCantidad,
        meseros, cajeros, domiciliarios, categorias, serie, hayDatos,
        cvLinea, cvPlatos, cvPago, cvCanal, cvHora, cvDia, cvCategoria,
        fmtCop, minsLabel, notaTiempo, tiempoDudoso, generandoExcel, descargarExcel,
      };
    },
    template: `
      <section class="card">
        <div class="dash-toolbar">
          <h2>Reportes</h2>
          <div class="dash-filtros dash-filtros-global">
            <select v-model="rangoClave" title="Rango de fechas">
              <option v-for="r in RANGOS" :key="r.clave" :value="r.clave">{{ r.label }}</option>
            </select>
            <input type="date" v-model="rangoDia" v-if="rangoClave === 'dia'" title="Día a mostrar">
            <input type="month" v-model="rangoMes" v-if="rangoClave === 'mesEspecifico'" title="Mes a mostrar">
            <select v-model="filtroCanal" title="Filtrar por canal">
              <option value="">Todos los canales</option>
              <option value="mesa">Mesa</option>
              <option value="domicilio">Domicilio</option>
              <option value="recoger">Recoger en tienda</option>
            </select>
            <select v-model="filtroPersona" title="Filtrar por persona">
              <option value="">Todo el equipo</option>
              <option v-for="p in personasDisponibles" :key="p" :value="p">{{ p }}</option>
            </select>
            <button type="button" class="dash-excel" @click="descargarExcel" :disabled="generandoExcel" title="Excel detallado del rango y filtros elegidos">
              {{ generandoExcel ? "Generando…" : "Descargar Excel" }}
            </button>
          </div>
        </div>

        <div class="dash-kpis dash-kpis-titular">
          <div class="kpi-card">
            <div class="kpi-value">{{ fmtCop(ventas.total) }}</div>
            <div class="kpi-label">Venta cobrada · {{ rangoLabel }}</div>
            <div class="kpi-delta" v-if="deltaTotal !== null" :class="deltaTotal >= 0 ? 'up' : 'down'">{{ deltaTotal >= 0 ? '▲' : '▼' }} {{ Math.abs(deltaTotal) }}% vs. periodo anterior</div>
            <div class="kpi-delta muted" v-else>Sin datos del periodo anterior</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">{{ fmtCop(ventas.ticketPromedio) }}</div>
            <div class="kpi-label">Ticket promedio</div>
            <div class="kpi-delta" v-if="deltaTicket !== null" :class="deltaTicket >= 0 ? 'up' : 'down'">{{ deltaTicket >= 0 ? '▲' : '▼' }} {{ Math.abs(deltaTicket) }}% vs. periodo anterior</div>
            <div class="kpi-delta muted" v-else>Sin datos del periodo anterior</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">{{ ventas.pedidos }}</div>
            <div class="kpi-label">Pedidos cobrados</div>
            <div class="kpi-delta" v-if="deltaPedidos !== null" :class="deltaPedidos >= 0 ? 'up' : 'down'">{{ deltaPedidos >= 0 ? '▲' : '▼' }} {{ Math.abs(deltaPedidos) }}% vs. periodo anterior</div>
            <div class="kpi-delta muted" v-else>Sin datos del periodo anterior</div>
          </div>
        </div>

        <div class="dash-subkpis">
          <span><b>{{ ventas.unidades.toLocaleString('es-CO') }}</b> unidades</span>
          <span><b>{{ ventas.itemsPorPedido }}</b> ítems por pedido</span>
          <span v-if="ventas.envios"><b>{{ fmtCop(ventas.envios) }}</b> en envíos</span>
          <span v-if="ventas.propinas"><b>{{ fmtCop(ventas.propinas) }}</b> en propinas</span>
        </div>

        <div class="dash-sec">
          <h3>Ventas</h3>
          <div class="dash-secfiltro">
            <select v-model="secc.ventas.clave" title="Rango de esta sección">
              <option value="">Sigue el filtro general</option>
              <option v-for="r in RANGOS" :key="r.clave" :value="r.clave">{{ r.label }}</option>
            </select>
            <input type="date" v-model="secc.ventas.dia" v-if="secc.ventas.clave === 'dia'">
            <input type="month" v-model="secc.ventas.mes" v-if="secc.ventas.clave === 'mesEspecifico'">
            <span class="dash-chip-propio" v-if="propio('ventas')">{{ rVentas.label }}
              <button type="button" @click="volverAlGlobal('ventas')" title="Volver al filtro general">×</button>
            </span>
          </div>
        </div>
        <div class="dash-subkpis">
          <span><b>{{ fmtCop(ventasSeccion.total) }}</b> en {{ rVentas.label.toLowerCase() }}</span>
          <span><b>{{ ventasSeccion.pedidos }}</b> pedidos</span>
        </div>
        <div class="chart-box" v-if="serie.length > 1"><canvas ref="cvLinea"></canvas></div>
        <p class="sub" v-else>La tendencia diaria se ve con un rango de más de un día.</p>

        <div class="dash-charts">
          <div>
            <h4 class="dash-subsec">Por canal</h4>
            <div class="chart-box chart-box-mid"><canvas ref="cvCanal"></canvas></div>
            <div class="dash-canal-rows">
              <div v-for="c in [canales.mesa, canales.domicilio, canales.recoger]" :key="c.canal">
                <span class="dash-canal-nombre">{{ c.canal === 'mesa' ? 'Mesa' : c.canal === 'domicilio' ? 'Domicilio' : 'Recoger' }}</span>
                <span>{{ c.pedidos }} ped. · ticket {{ fmtCop(c.ticketPromedio) }}</span>
              </div>
            </div>
          </div>
          <div>
            <h4 class="dash-subsec">Por método de pago</h4>
            <div class="chart-box chart-box-pie"><canvas ref="cvPago"></canvas></div>
          </div>
        </div>

        <div class="dash-sec">
          <h3>Operación</h3>
          <div class="dash-secfiltro">
            <select v-model="secc.operacion.clave" title="Rango de esta sección">
              <option value="">Sigue el filtro general</option>
              <option v-for="r in RANGOS" :key="r.clave" :value="r.clave">{{ r.label }}</option>
            </select>
            <input type="date" v-model="secc.operacion.dia" v-if="secc.operacion.clave === 'dia'">
            <input type="month" v-model="secc.operacion.mes" v-if="secc.operacion.clave === 'mesEspecifico'">
            <span class="dash-chip-propio" v-if="propio('operacion')">{{ rOperacion.label }}
              <button type="button" @click="volverAlGlobal('operacion')" title="Volver al filtro general">×</button>
            </span>
          </div>
        </div>
        <div class="dash-tiempos">
          <div v-for="t in [
                {k:'cocina', v:tiempos.detalle.cocina.mediana, d:tiempos.detalle.cocina, l:'Cocina'},
                {k:'entrega', v:tiempos.detalle.entrega.mediana, d:tiempos.detalle.entrega, l:'Entrega a domicilio'},
                {k:'confirmacion', v:tiempos.detalle.confirmacion.mediana, d:tiempos.detalle.confirmacion, l:'Caja confirma'}]"
               :key="t.k" class="dash-tiempo" :class="{ 'es-dudoso': tiempoDudoso(t.d) }">
            <span class="dash-tiempo-valor">{{ minsLabel(t.v) }}</span>
            <span class="dash-tiempo-label">{{ t.l }}</span>
            <span class="dash-tiempo-nota">{{ notaTiempo(t.d) }}</span>
          </div>
          <div class="dash-tiempo" :class="{ 'es-dudoso': tiempos.muestrasEta < 5 }">
            <span class="dash-tiempo-valor">{{ tiempos.pctATiempo === null ? '—' : tiempos.pctATiempo + '%' }}</span>
            <span class="dash-tiempo-label">A tiempo vs. estimado</span>
            <span class="dash-tiempo-nota">{{ tiempos.muestrasEta ? tiempos.muestrasEta + ' con estimado' : 'Nadie puso estimado' }}</span>
          </div>
        </div>
        <p class="dash-aviso" v-if="tiempoDudoso(tiempos.detalle.cocina)">
          Con menos de 5 pedidos medidos, un solo caso raro mueve el promedio — toma estos tiempos como referencia, no como dato firme.
        </p>

        <div class="dash-charts">
          <div>
            <h4 class="dash-subsec">Pedidos por hora</h4>
            <div class="chart-box chart-box-mid"><canvas ref="cvHora"></canvas></div>
          </div>
          <div>
            <h4 class="dash-subsec">Por día de la semana</h4>
            <div class="chart-box chart-box-mid"><canvas ref="cvDia"></canvas></div>
          </div>
        </div>

        <div class="dash-incidencias">
          <div>
            <span class="dash-inc-num">{{ tasas.pctCancelados }}%</span>
            <span class="dash-inc-label">Cancelados ({{ tasas.cancelados }})</span>
            <ul v-if="tasas.motivosCancelacion.length"><li v-for="m in tasas.motivosCancelacion" :key="m.motivo">{{ m.motivo }} · {{ m.n }}</li></ul>
          </div>
          <div>
            <span class="dash-inc-num">{{ tasas.pctNoEntregados }}%</span>
            <span class="dash-inc-label">No entregados ({{ tasas.noEntregados }})</span>
            <ul v-if="tasas.motivosNoEntrega.length"><li v-for="m in tasas.motivosNoEntrega" :key="m.motivo">{{ m.motivo }} · {{ m.n }}</li></ul>
          </div>
        </div>

        <div class="dash-sec">
          <h3>Productos</h3>
          <div class="dash-secfiltro">
            <select v-model="secc.productos.clave" title="Rango de esta sección">
              <option value="">Sigue el filtro general</option>
              <option v-for="r in RANGOS" :key="r.clave" :value="r.clave">{{ r.label }}</option>
            </select>
            <input type="date" v-model="secc.productos.dia" v-if="secc.productos.clave === 'dia'">
            <input type="month" v-model="secc.productos.mes" v-if="secc.productos.clave === 'mesEspecifico'">
            <span class="dash-chip-propio" v-if="propio('productos')">{{ rProductos.label }}
              <button type="button" @click="volverAlGlobal('productos')" title="Volver al filtro general">×</button>
            </span>
          </div>
        </div>
        <div class="dash-filtros">
          <select v-model="filtroCategoria" title="Filtrar por categoría">
            <option value="">Todas las categorías</option>
            <option v-for="c in categoriasDisponibles" :key="c" :value="c">{{ c }}</option>
          </select>
          <input type="text" class="filtro-codigo" v-model="filtroCodigo" placeholder="Buscar por código o nombre…">
        </div>
        <div class="dash-charts">
          <div><div class="chart-box"><canvas ref="cvPlatos"></canvas></div></div>
          <div>
            <h4 class="dash-subsec">Por categoría</h4>
            <div class="chart-box"><canvas ref="cvCategoria"></canvas></div>
          </div>
        </div>

        <div class="dash-ranking" v-if="topPlatos.length">
          <table>
            <thead><tr><th>Código</th><th>Plato</th><th>Unidades</th><th>Total</th></tr></thead>
            <tbody>
              <tr v-for="f in topPlatos" :key="f.codigo">
                <td>{{ f.codigo }}</td>
                <td>
                  {{ f.nombre }}
                  <div class="barra-wrap"><div class="barra-fill" :style="{ width: (f.cantidad / maxCantidad * 100) + '%' }"></div></div>
                </td>
                <td class="num">{{ f.cantidad }}</td>
                <td class="num">{{ fmtCop(f.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="sub" v-else>No hay platos vendidos con esos filtros.</p>

        <div class="dash-sec">
          <h3>Equipo</h3>
          <div class="dash-secfiltro">
            <select v-model="secc.equipo.clave" title="Rango de esta sección">
              <option value="">Sigue el filtro general</option>
              <option v-for="r in RANGOS" :key="r.clave" :value="r.clave">{{ r.label }}</option>
            </select>
            <input type="date" v-model="secc.equipo.dia" v-if="secc.equipo.clave === 'dia'">
            <input type="month" v-model="secc.equipo.mes" v-if="secc.equipo.clave === 'mesEspecifico'">
            <span class="dash-chip-propio" v-if="propio('equipo')">{{ rEquipo.label }}
              <button type="button" @click="volverAlGlobal('equipo')" title="Volver al filtro general">×</button>
            </span>
          </div>
        </div>
        <div class="dash-personas">
          <div v-for="grupo in [{t:'Meseros',rows:meseros},{t:'Cajeros',rows:cajeros},{t:'Domiciliarios',rows:domiciliarios}]" :key="grupo.t">
            <h4 class="dash-subsec">{{ grupo.t }}</h4>
            <table v-if="grupo.rows.length">
              <thead><tr><th>Nombre</th><th>Ped.</th><th>Total</th></tr></thead>
              <tbody>
                <tr v-for="r in grupo.rows" :key="r.nombre">
                  <td>{{ r.nombre }}</td>
                  <td class="num">{{ r.pedidos }}</td>
                  <td class="num">{{ fmtCop(r.total) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="sub" v-else>Sin datos en este rango.</p>
          </div>
        </div>

        <p class="sub" v-if="!hayDatos">No hay pedidos en el rango elegido.</p>
      </section>
    `
  });

  app.mount("#vistaDashboard");
})();
