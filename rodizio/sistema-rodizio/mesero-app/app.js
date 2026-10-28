/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* ═══════════════════════════════════════════════════════════════
   Rodizio · Meseros — vanilla JS, un solo archivo, sin build.
   Los pedidos viven en Firebase Realtime Database (REST + SSE),
   así que se sincronizan al instante con el Panel de cocina.
   Sesión: guard de Firebase Authentication + rol "mesero" (ver
   shared/auth.js y shared/roles.js) — el login en sí ocurre en el
   login raíz (/index.html); esta app solo verifica y, si falla,
   redirige de vuelta ahí.
   ═══════════════════════════════════════════════════════════════ */

      // MENU/SUGERENCIAS los carga shared/menu-loader.js desde RTDB (Fase 2).
      // Antes venían fijos de shared/menu.js. CATS/ITEM_INDEX se llenan en
      // indexarMenu(), después de `await esperarMenu()` (ver iniciarSesion).
      let CATS = [];
      const ITEM_INDEX = {};
      function indexarMenu() {
        CATS = MENU.map((g) => g.cat);
        MENU.forEach((g) =>
          g.items.forEach((i) => {
            ITEM_INDEX[i.id] = Object.assign({ cat: g.cat }, i);
          }),
        );
      }
      const ETIQUETA = {
        recibido: 'Recibido',
        enviado: 'Enviado',
        preparacion: 'En preparación',
        listo: 'Listo para servir',
        en_camino: 'En camino',
        entregado: 'Servido',
      };
      const ESTADOS = ['enviado', 'preparacion', 'listo', 'entregado'];

      /* ── Firebase Realtime Database — vía el SDK oficial (Fase 2b) ──
   dbGet / dbPush / dbUpdate / dbDelete / escucharSSE / siguienteCodigo
   vienen de ../shared/firebase.js (módulo ES). escucharSSE(path, onData,
   onStatus): onData recibe el árbol completo en cada cambio. ── */

      // escapeHtml viene de ../shared/util.js. "cop" es solo un alias local
      // hacia fmtCop (mismo shared/util.js) para no tocar los usos de cop(...)
      // repartidos por el resto de este archivo.
      const cop = fmtCop;

      /* ── Estado de la app ──
   mesaId es solo la mesa que ELEGISTE en esta pantalla ahora mismo —
   una selección local, sin dueño ni reserva. Cualquier mesero puede
   elegir cualquier mesa en cualquier momento, esté o no ocupada, para
   agregarle una comanda nueva.
   Las mesas NO viven en Firebase: arrancan como Mesa 1..20 acá abajo,
   se les puede agregar otra con nombre libre desde "+ Abrir otra", y
   se reconstruyen solas para los demás meseros a partir de los pedidos
   sin pagar que llegan por SSE (ver conectarPedidos). Ver CLAUDE.md,
   sección "Mesas". ── */
      const defaultMesas = {};
      for (let i = 1; i <= 20; i++) {
        defaultMesas[`mesa-${i}`] = { nombre: `Mesa ${i}`, activa: true };
      }
      const state = {
        cargandoSesion: true,
        perfil: null,
        uid: null,
        mesero: '',
        mesaId: null,
        mesas: defaultMesas,
        tab: 'mesas',
        cat: null, // se fija a CATS[0] tras cargar el menú (indexarMenu)
        carrito: [],
        comandaAbierta: false,
        pedidos: {},
        solicitudes: {},
        conectado: false,
        toast: '',
        editandoPedidoId: null,
        busqueda: '',
        // Nombre del cliente que armó el pedido por QR (si vino de una
        // solicitud confirmada) — viaja al pedido nuevo; null si el mesero
        // cargó la comanda directo, sin pasar por panel-cliente.
        clienteNombre: null,
        // Bandera en el state (no solo un atributo DOM transitorio) para
        // que un re-render de por medio (ej. cerrar y reabrir el drawer
        // mientras la comanda anterior sigue en vuelo) no vuelva a crear
        // un botón "Enviar" habilitado y permita mandar el pedido 2 veces.
        enviando: false,
      };

      /* ── Persistencia del carrito por mesa ──
   carritosPorMesa guarda el carrito de cada mesa para que no se pierda
   al cambiar de pestaña o seleccionar otra mesa. */
      const carritosPorMesa = {};

      function guardarCarritoMesa() {
        if (state.mesaId) {
          carritosPorMesa[state.mesaId] = {
            carrito: state.carrito.map((l) => Object.assign({}, l)),
            editandoPedidoId: state.editandoPedidoId,
            clienteNombre: state.clienteNombre,
          };
        }
      }

      function restaurarCarritoMesa(mesaId) {
        const guardado = carritosPorMesa[mesaId];
        if (guardado && guardado.carrito.length > 0) {
          return {
            carrito: guardado.carrito.map((l) => Object.assign({}, l)),
            editandoPedidoId: guardado.editandoPedidoId,
            clienteNombre: guardado.clienteNombre || null,
          };
        }
        return { carrito: [], editandoPedidoId: null, clienteNombre: null };
      }

      function limpiarCarritoMesa(mesaId) {
        delete carritosPorMesa[mesaId];
      }

      // La mesa elegida ahora mismo (objeto de state.mesas), o null.
      function mesaActual() {
        return state.mesaId ? state.mesas[state.mesaId] : null;
      }
      function nombreMesaActual() {
        const m = mesaActual();
        return m ? m.nombre : null;
      }

      // Ocupada = tiene al menos un pedido sin pagar — se calcula al vuelo
      // desde /pedidos (ya lo tenemos en memoria por el SSE de conectarPedidos),
      // no se guarda como bandera aparte. Así nunca puede quedar desincronizada.
      function mesaOcupada(id) {
        return Object.values(state.pedidos).some(
          (p) => p && p.mesaId === id && !p.pagado && statusDe(p) !== "cancelado",
        );
      }

      // El pedido "en curso" de una mesa: el más reciente sin pagar. Pedir
      // algo más durante la misma sentada debe sumarse a ESE pedido como una
      // ronda nueva (ver agregarRonda) en vez de crear una comanda/ticket
      // aparte — antes cada envío a una mesa ocupada creaba un pedido nuevo,
      // duplicando el ticket en cocina y en la pestaña "Pedidos" del mesero.
      function pedidoActivoDeMesa(mesaId) {
        const candidatos = Object.entries(state.pedidos)
          .filter(([, p]) => p && p.mesaId === mesaId && !p.pagado && statusDe(p) !== "cancelado")
          .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
        return candidatos.length ? candidatos[0] : null;
      }

      function setState(patch) {
        Object.assign(state, patch);
        render();
      }
      function aviso(t, opts) {
        window.mostrarToast(t, opts);
      }

      /* ── Escucha en vivo de /pedidos (solo los del mesero en turno se muestran) ── */
      let primeraCargaPedidos = true;
      let prevEstados = {}; // id -> estado, para detectar cuándo un pedido pasa a "listo"

      function conectarPedidos() {
        escucharSSE('/orders', (data) => {
          state.pedidos = data || {};
          Object.values(state.pedidos).forEach((p) => {
            if (p && p.mesa && !p.pagado) {
              let raw = String(p.mesa).trim();
              let numMatch = raw.match(/\d+/);
              let id = p.mesaId || (numMatch ? `mesa-${numMatch[0]}` : raw);
              let nombre = raw.toLowerCase().startsWith('mesa') ? raw : (numMatch ? `Mesa ${numMatch[0]}` : raw);
              if (!state.mesas[id]) {
                state.mesas[id] = { nombre, activa: true };
              }
            }
          });
          detectarPedidosListos();
          setState({ conectado: true });
        }, (ok) => setState({ conectado: ok }));
      }

      /* ── Escucha en vivo de /solicitudes (carritos pendientes de panel-cliente) ──
   Cada mesaId con solicitud es una mesa donde un cliente ya armó (y
   mandó) su pedido desde el QR, pendiente de que el mesero lo revise
   y confirme — ver panel-cliente/app.js y CLAUDE.md. ── */
      let primeraCargaSolicitudes = true;
      let prevSolicitudes = {}; // mesaId -> tenía líneas o no, para detectar solicitudes nuevas

      function solicitudPendiente(id) {
        const s = state.solicitudes[id];
        return s && (s.lineas || []).length > 0 ? s : null;
      }

      function conectarSolicitudes() {
        escucharSSE('/solicitudes', (data) => {
          state.solicitudes = data || {};
          Object.entries(state.solicitudes).forEach(([id, s]) => {
            const tieneAhora = !!solicitudPendiente(id);
            // Una mesa especial generada por QR (no en Mesa 1..20) puede
            // llegar acá antes que en /pedidos — registrarla igual que
            // conectarPedidos() hace para pedidos de mesas desconocidas.
            if (tieneAhora && !state.mesas[id]) {
              state.mesas[id] = { nombre: (s && s.mesa) || id, activa: true };
            }
            if (tieneAhora && !prevSolicitudes[id] && !primeraCargaSolicitudes) {
              avisarSolicitud(id);
            }
            prevSolicitudes[id] = tieneAhora;
          });
          primeraCargaSolicitudes = false;
          render();
        });
      }

      // Tono propio (distinto al de "pedido listo") para distinguir un
      // pedido nuevo del cliente de un pedido propio que ya está listo.
      const beepSolicitud = crearBeep([523, 659, 784]);

      function avisarSolicitud(mesaId) {
        beepSolicitud();
        const nombre = state.mesas[mesaId] ? state.mesas[mesaId].nombre : mesaId;
        aviso(nombre + ' hizo un pedido desde su mesa', { icono: 'restaurant' });
      }

      function confirmarSolicitud(mesaId) {
        const solicitud = solicitudPendiente(mesaId);
        if (!solicitud) return;
        if (
          state.carrito.length > 0 &&
          !confirm(
            'Ya tienes ítems sin enviar en la comanda de esta mesa — ¿reemplazarlos con el pedido del cliente?',
          )
        ) {
          return;
        }
        const carrito = solicitud.lineas.map((l) => ({
          id: l.id,
          qty: l.qty,
          nota: l.nota || '',
        }));
        setState({
          carrito,
          comandaAbierta: true,
          clienteNombre: solicitud.cliente || null,
        });
      }

      async function descartarSolicitud(mesaId) {
        try {
          await dbDelete(`/solicitudes/${mesaId}`);
        } catch (e) {
          aviso('No se pudo descartar — revisa la conexión');
        }
      }

      /* ── Mesas: generadas automáticamente (1 al 20) o agregadas localmente ── */

      // Elegir mesa es una selección local, nada más — no escribe en Firebase.
      // Cualquier mesero puede elegir cualquier mesa activa, esté libre u
      // ocupada. Al elegir una mesa ocupada, el carrito empieza VACÍO — lo
      // que se agregue y se envíe se suma como una ronda nueva al pedido en
      // curso de esa mesa (ver pedidoActivoDeMesa/agregarRonda), no crea un
      // pedido separado. El carrito previo de la mesa actual se guarda antes
      // de cambiar.
      function elegirMesa(id) {
        if (!state.mesas[id]) return;
        // Guardar carrito de la mesa actual antes de cambiar
        guardarCarritoMesa();
        // Restaurar carrito guardado de la mesa destino (si tenía algo pendiente)
        const restaurado = restaurarCarritoMesa(id);
        setState({
          mesaId: id,
          tab: 'menu',
          carrito: restaurado.carrito,
          editandoPedidoId: restaurado.editandoPedidoId,
          clienteNombre: restaurado.clienteNombre,
          busqueda: '',
        });
      }

      // Editar pedido: solo para pedidos en estado "enviado" Y de una sola
      // ronda — igual que cancelarPedido. Con más de una ronda, p.estado
      // (el resumen del ticket) puede dar "enviado" solo porque la ronda
      // MÁS NUEVA sigue sin tomar, aunque una ronda anterior ya esté en
      // preparación o lista — sobreescribir "lineas" completo ahí borraría
      // ese avance, así que en ese caso no se puede editar el pedido entero.
      function editarPedido(pedidoId) {
        const p = state.pedidos[pedidoId];
        if (!p || statusDe(p) !== "enviado" || (p.rondaActual && p.rondaActual > 1)) {
          aviso(
            'Solo se pueden editar pedidos que no han sido tomados por cocina',
          );
          return;
        }
        // Guardar carrito actual antes de entrar en modo edición
        guardarCarritoMesa();
        const carrito = (p.lineas || []).map((l) => Object.assign({}, l));
        const mesaId =
          p.mesaId ||
          Object.keys(state.mesas).find(
            (k) => state.mesas[k].nombre === p.mesa,
          );
        setState({
          mesaId: mesaId || state.mesaId,
          tab: 'menu',
          carrito,
          editandoPedidoId: pedidoId,
          clienteNombre: p.cliente || null,
          busqueda: '',
        });
        aviso('Editando pedido ' + (p.codigo || pedidoId));
      }

      // Cancelar un pedido — solo mientras sigue en "enviado", igual que
      // editar. A diferencia de vaciar el carrito en modo edición (eso solo
      // deshabilita "Enviar", el pedido original queda intacto), esto marca
      // el pedido como "cancelado" de verdad (NO se borra de Firebase — el
      // dueño necesita que quede registro de qué se canceló y por qué para
      // su reporte de caja). mesaOcupada()/pedidoActivoDeMesa() ya excluyen
      // los cancelados, así que la mesa se ve libre igual, y no aparece en
      // el tablero de panel-cocina ni en panel-caja (ambos filtran por los
      // 4 estados normales, "cancelado" no calza en ninguno).
      async function cancelarPedido(pedidoId) {
        const p = state.pedidos[pedidoId];
        if (!p || statusDe(p) !== "enviado") {
          aviso(
            'Solo se pueden cancelar pedidos que no han sido tomados por cocina',
          );
          return;
        }
        // Si ya tiene más de una ronda, es porque en algún momento cocina
        // llegó a tomar la primera (o el cliente ya recibió algo) y luego
        // se agregó más — cancelar perdería el registro de esa parte ya en
        // curso o ya servida. En ese caso solo se puede seguir
        // avisando/editando ronda por ronda, no cancelar el pedido entero.
        if (p.rondaActual && p.rondaActual > 1) {
          aviso(
            'Este pedido ya tiene más de una ronda — no se puede cancelar entero, solo avisar a cocina',
          );
          return;
        }
        const ok = confirm(
          `¿Cancelar el pedido ${p.codigo || ''} de ${p.mesa || 'esta mesa'}?\n\nQueda registrado como cancelado — no se puede deshacer.`,
        );
        if (!ok) return;
        const motivo = (prompt('Motivo de la cancelación (opcional):') || '').trim();
        const patch = {
          status: 'cancelado',
          canceladoPor: state.mesero,
          tsCancelado: Date.now(),
        };
        if (motivo) patch.motivoCancelacion = motivo;
        try {
          await dbUpdate(`/orders/${pedidoId}`, patch);
          if (state.editandoPedidoId === pedidoId) {
            limpiarCarritoMesa(state.mesaId);
            setState({ carrito: [], editandoPedidoId: null, comandaAbierta: false, clienteNombre: null });
          } else {
            render();
          }
          aviso('Pedido cancelado · ' + (p.mesa || ''));
        } catch (e) {
          aviso('No se pudo cancelar — revisa la conexión');
        }
      }

      // Aviso de cambio a cocina — para cuando el cliente pide modificar o
      // quitar algo DESPUÉS de que cocina ya tomó el pedido (estado
      // "preparacion"/"listo"), donde ya no se puede editar/cancelar en
      // silencio desde acá. En vez de reescribir "lineas" sin que cocina se
      // entere, esto solo cuelga un aviso visible+sonoro en panel-cocina
      // para que se coordinen de viva voz — el pedido real no se toca.
      async function avisarCambioCocina(pedidoId) {
        const p = state.pedidos[pedidoId];
        if (!p) return;
        const nota = prompt(
          '¿Qué quiere cambiar o quitar el cliente? (esto solo avisa a cocina, no modifica el pedido)',
          '',
        );
        if (nota === null) return;
        try {
          await dbUpdate(`/orders/${pedidoId}`, {
            avisoCambio: { mensaje: nota.trim(), mesero: state.mesero, ts: Date.now() },
          });
          aviso('Aviso enviado a cocina · ' + (p.mesa || ''));
        } catch (e) {
          aviso('No se pudo avisar — revisa la conexión');
        }
      }

      // Avisa (sonido + notificación del sistema) apenas un pedido del mesero
      // actual pasa a "listo" — sin importar en qué mesa o pestaña esté parado,
      // así no tiene que ir hasta la otra mesa a comprobar.
      function detectarPedidosListos() {
        Object.entries(state.pedidos).forEach(([id, p]) => {
          if (!p || p.mesero !== state.mesero) {
            prevEstados[id] = p ? statusDe(p) : undefined;
            return;
          }
          const antes = prevEstados[id];
          if (
            statusDe(p) === "listo" &&
            antes !== 'listo' &&
            !primeraCargaPedidos
          ) {
            avisarListo(p);
          }
          prevEstados[id] = statusDe(p);
        });
        primeraCargaPedidos = false;
      }

      function pedirPermisoNotificaciones() {
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {});
        }
      }

      // Tono propio de "pedido listo" (distinto al de aviso de cocina/caja),
      // generado con la fábrica compartida crearBeep() de ../shared/util.js.
      const beepListo = crearBeep([740, 1040]);

      function avisarListo(p) {
        beepListo();
        aviso(p.mesa + ' lista · ' + (p.codigo || ''), { icono: 'notifications' });
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(p.mesa + ' lista para servir', {
              body: (p.codigo || 'Pedido') + ' · toca para ver el detalle',
              icon: '../icons/icon-192.png',
              tag: 'rodizio-listo',
            });
          } catch (e) {}
        }
      }

      /* ── Auth — sesión de Firebase Authentication verificada contra el rol
   "mesero" en /trabajadores/{uid} (ver shared/auth.js y shared/roles.js).
   "admin" también pasa el guard de cualquier panel, para poder
   supervisar/probar sin necesitar cada rol asignado por separado.
   El login en sí ocurre en el login raíz (/index.html); esta app solo
   valida en cada carga y expulsa si no hay sesión, el perfil no existe,
   está inactivo, o no tiene el rol "mesero" (ni "admin"). ── */
      function esperarAuthListo() {
        return new Promise((resolve) => {
          (function chequear() {
            if (window.onAuthStateChanged && window.logout && window.dbGet && window.escucharSSE && window.esperarMenu) resolve();
            else setTimeout(chequear, 30);
          })();
        });
      }

      async function salir() {
        await logout();
        window.location.href = '../index.html';
      }

      async function iniciarSesion() {
        await esperarAuthListo();
        onAuthStateChanged(async (user) => {
          if (!user) {
            window.location.href = '../index.html';
            return;
          }
          let perfil;
          try {
            perfil = await getWorkerProfile(user.uid);
          } catch (e) {
            window.location.href = '../index.html';
            return;
          }
          // Cualquier trabajador activo puede operar como mesero — ya no
          // depende de que el admin le asigne el rol "mesero" puntualmente
          // (los turnos rotan). Solo se cierra sesión de verdad si la cuenta
          // no existe o está inactiva; si el perfil es válido no hay que
          // sacarlo de Firebase Authentication.
          if (!perfil || perfil.estado !== 'activo') {
            await logout();
            window.location.href = '../index.html';
            return;
          }
          // El admin entra a observar, no a operar: ve todo en vivo pero
          // no puede crear/editar pedidos ni tocar mesas (barrera real en
          // shared/firebase.js vía window.__SOLO_LECTURA).
          if (hasRole(perfil, 'admin')) activarModoObservador('Administrador');
          // El menú se carga de RTDB (shared/menu-loader.js). Esperar a
          // que esté antes de salir de la pantalla de carga, si no
          // renderMenu() se pinta vacío.
          await esperarMenu();
          indexarMenu();
          setState({
            cargandoSesion: false,
            perfil,
            uid: user.uid,
            mesero: perfil.nombre || perfil.usuario || 'Mesero',
            cat: state.cat || CATS[0] || null,
          });
          conectarPedidos();
          conectarSolicitudes();
          pedirPermisoNotificaciones();
        });
      }

      /* ── Carrito ── */
      function cambiar(id, delta) {
        const carrito = state.carrito.slice();
        const i = carrito.findIndex((l) => l.id === id);
        if (i === -1) {
          if (delta > 0) carrito.push({ id, qty: 1, nota: '' });
        } else {
          const q = carrito[i].qty + delta;
          if (q <= 0) carrito.splice(i, 1);
          else carrito[i] = Object.assign({}, carrito[i], { qty: q });
        }
        setState({ carrito });
      }
      function setNota(id, nota) {
        setState({
          carrito: state.carrito.map((l) =>
            l.id === id ? Object.assign({}, l, { nota }) : l,
          ),
        });
      }
      function notaPartes(nota) {
        return String(nota || '')
          .split(' · ')
          .map((parte) => parte.trim())
          .filter(Boolean);
      }
      function alternarSugerencia(id, sugerencia) {
        const linea = state.carrito.find((l) => l.id === id);
        if (!linea) return;
        const partes = notaPartes(linea.nota);
        const indice = partes.indexOf(sugerencia);
        if (indice === -1) partes.unshift(sugerencia);
        else partes.splice(indice, 1);
        setNota(id, partes.join(' · '));
      }
      function total() {
        return state.carrito.reduce(
          (s, l) => s + ITEM_INDEX[l.id].precio * l.qty,
          0,
        );
      }

      /* ── Enviar comanda a Firebase ── */
      async function enviar() {
        // Guardado en state (no solo deshabilitando el botón en el DOM):
        // así, si de por medio se cierra/reabre el drawer mientras la
        // petición sigue en vuelo, el nuevo botón "Enviar" que se rendericé
        // también nace deshabilitado — sin esto, una conexión lenta permitía
        // reabrir el drawer y mandar la misma comanda dos veces.
        if (state.enviando) return;
        setState({ enviando: true });
        const btn = document.getElementById('btnEnviar');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Enviando…';
        }
        const lineas = state.carrito.map((l) => ({
          id: l.id,
          nombre: ITEM_INDEX[l.id].nombre,
          cat: ITEM_INDEX[l.id].cat,
          qty: l.qty,
          precio: ITEM_INDEX[l.id].precio,
          nota: (l.nota || '').trim(),
          // Se conserva la ronda si ya la traía (ej. viene de editar un
          // pedido con varias rondas) — ver agruparPorRonda()/agregarRonda().
          ronda: l.ronda || 1,
        }));
        const totalPedido = lineas.reduce((s, l) => s + l.precio * l.qty, 0);
        const nombreMesa = nombreMesaActual();

        try {
          if (state.editandoPedidoId) {
            // Verificar que el pedido sigue en estado "enviado" y de una sola
            // ronda (pudo haber avanzado, o haberse sumado una ronda nueva,
            // mientras el mesero editaba) — si no, ya no se puede sobreescribir
            // "lineas" completo en silencio: se suma como ronda nueva al
            // pedido que cocina ya tiene (nunca se crea un ticket aparte para
            // la misma mesa/sentada).
            const pedidoExistente = state.pedidos[state.editandoPedidoId];
            if (
              pedidoExistente &&
              statusDe(pedidoExistente) === "enviado" &&
              (!pedidoExistente.rondaActual || pedidoExistente.rondaActual === 1)
            ) {
              try {
                await dbUpdate(`/orders/${state.editandoPedidoId}`, {
                  lineas,
                  total: totalPedido,
                  tsModificado: Date.now(),
                });
                limpiarCarritoMesa(state.mesaId);
                setState({
                  carrito: [],
                  comandaAbierta: false,
                  tab: 'pedidos',
                  editandoPedidoId: null,
                  clienteNombre: null,
                });
                aviso('Comanda actualizada · ' + nombreMesa);
              } catch (e) {
                aviso('No se pudo actualizar — revisa la conexión');
              }
            } else {
              aviso('Cocina ya tomó ese pedido — se agrega como ronda nueva');
              state.editandoPedidoId = null;
              await enviarOAgregar(lineas, totalPedido, nombreMesa);
            }
          } else {
            await enviarOAgregar(lineas, totalPedido, nombreMesa);
          }
        } finally {
          // Se resetea siempre (éxito o error) y vía setState — así, aunque
          // el drawer se haya cerrado y reabierto de por medio (creando un
          // botón nuevo en el DOM), el próximo render ya sabe que se puede
          // volver a enviar en vez de quedar bloqueado o duplicar el envío.
          setState({ enviando: false });
          const btnActual = document.getElementById('btnEnviar');
          if (btnActual) {
            btnActual.disabled = state.carrito.length === 0;
            btnActual.textContent = 'Enviar a cocina';
          }
        }
      }

      // Punto único de salida al enviar: si la mesa ya tiene un pedido en
      // curso (sin pagar), lo que se manda se SUMA a ese pedido como una
      // ronda nueva — nunca crea una comanda/ticket aparte para la misma
      // mesa mientras siga abierta. Si no hay pedido activo, recién ahí se
      // crea uno (ronda 1). Este es el arreglo al bug reportado: pedir algo
      // más en la misma mesa ya no duplicaba el pedido ni el ticket.
      async function enviarOAgregar(lineas, totalPedido, nombreMesa) {
        const activo = pedidoActivoDeMesa(state.mesaId);
        if (activo) {
          await agregarRonda(activo[0], activo[1], lineas);
        } else {
          await enviarNuevo(lineas, totalPedido, nombreMesa);
        }
      }

      // Agrega una ronda nueva al pedido EXISTENTE de la mesa (mismo ticket,
      // mismo código) en vez de crear uno aparte. La ronda nueva arranca en
      // "enviado" en rondaEstados — las rondas anteriores NO se tocan, así
      // que si una ya estaba lista o servida, se queda así (antes todo el
      // pedido volvía a "enviado" y parecía que había que preparar de nuevo
      // hasta lo que ya había salido — ver estadoEfectivoTicket en
      // shared/util.js). tsUltimaRonda sigue disparando el aviso sonoro en
      // panel-cocina. No pasa por "avisar cambio a cocina" — ese aviso es
      // solo para pedir modificar/quitar algo ya en curso.
      async function agregarRonda(pedidoId, pedidoExistente, lineasNuevas) {
        const rondaSiguiente = (pedidoExistente.rondaActual || 1) + 1;
        const ahora = Date.now();
        const lineasConRonda = lineasNuevas.map((l) =>
          Object.assign({}, l, { ronda: rondaSiguiente }),
        );
        const lineasCombinadas = (pedidoExistente.lineas || []).concat(
          lineasConRonda,
        );
        const totalCombinado = lineasCombinadas.reduce(
          (s, l) => s + l.precio * l.qty,
          0,
        );
        const rondas = Object.assign(
          {},
          pedidoExistente.rondas || { 1: pedidoExistente.ts },
          { [rondaSiguiente]: ahora },
        );
        const rondaEstados = rondaEstadosCon(pedidoExistente);
        rondaEstados[rondaSiguiente] = 'enviado';
        const patch = {
          lineas: lineasCombinadas,
          total: totalCombinado,
          rondas,
          rondaActual: rondaSiguiente,
          tsUltimaRonda: ahora,
          rondaEstados,
          tsCambio: ahora,
        };
        patch.status = estadoEfectivoTicket(Object.assign({}, pedidoExistente, patch));
        try {
          await dbUpdate(`/orders/${pedidoId}`, patch);
          limpiarCarritoMesa(state.mesaId);
          if (solicitudPendiente(state.mesaId)) {
            dbDelete(`/solicitudes/${state.mesaId}`).catch(() => {});
          }
          setState({
            carrito: [],
            comandaAbierta: false,
            tab: 'pedidos',
            editandoPedidoId: null,
            clienteNombre: null,
          });
          aviso(
            'Se agregó a la comanda ' +
              (pedidoExistente.codigo || '') +
              ' · ' +
              (pedidoExistente.mesa || ''),
          );
        } catch (e) {
          aviso('No se pudo agregar — revisa la conexión');
        }
      }

      async function enviarNuevo(lineas, totalPedido, nombreMesa) {
        const codigo = await siguienteCodigo("P");
        const ts = Date.now();
        const lineasRonda1 = lineas.map((l) =>
          Object.assign({}, l, { ronda: 1 }),
        );
        const pedido = {
          // "mesa" guarda el NOMBRE (lo que muestran cocina y caja tal cual);
          // "mesaId" es la referencia a /mesas, usada solo para calcular si la
          // mesa sigue ocupada (mesaOcupada() en base a pedidos sin pagar).
          codigo,
          mesa: nombreMesa,
          mesaId: state.mesaId,
          mesero: state.mesero,
          meseroUsuario: state.perfil ? state.perfil.usuario : '',
          lineas: lineasRonda1,
          total: totalPedido,
          status: 'enviado',
          origen: 'mesa',
          ts,
          rondaActual: 1,
          rondas: { 1: ts },
          rondaEstados: { 1: 'enviado' },
          tsUltimaRonda: ts,
        };
        // "cliente" solo viaja si el pedido vino de una solicitud confirmada
        // (panel-cliente) — si el mesero lo cargó directo, no se incluye, y
        // panel-cocina usa el nombre del mesero como respaldo (ver CLAUDE.md).
        if (state.clienteNombre) pedido.cliente = state.clienteNombre;
        try {
          await dbPush('/orders', pedido);
          limpiarCarritoMesa(state.mesaId);
          // Si esta mesa tenía un pedido de cliente pendiente, ya se cargó
          // (o se descartó) — no volver a ofrecerlo una vez enviado a cocina.
          if (solicitudPendiente(state.mesaId)) {
            dbDelete(`/solicitudes/${state.mesaId}`).catch(() => {});
          }
          setState({
            carrito: [],
            comandaAbierta: false,
            tab: 'pedidos',
            editandoPedidoId: null,
            clienteNombre: null,
          });
          aviso('Comanda ' + codigo + ' enviada a cocina · ' + nombreMesa);
        } catch (e) {
          aviso('No se pudo enviar — revisa la conexión');
        }
      }

      // ids "pedido:ronda" con un marcarServido en curso — un doble toque (o
      // una conexión lenta) no debe disparar dos peticiones para la misma
      // ronda. Servir es por ronda, no del pedido completo: el mesero puede
      // recoger la ronda 1 en cuanto esté lista sin esperar a que la ronda 2
      // también lo esté (ver estadoEfectivoTicket en shared/util.js).
      const marcandoServido = new Set();
      async function marcarServido(id, ronda) {
        const key = id + ':' + ronda;
        if (marcandoServido.has(key)) return;
        marcandoServido.add(key);
        try {
          const p = state.pedidos[id];
          if (!p) return;
          const rondaEstados = rondaEstadosCon(p);
          rondaEstados[ronda] = 'entregado';
          const patch = { rondaEstados, tsCambio: Date.now() };
          patch.status = estadoEfectivoTicket(Object.assign({}, p, patch));
          await dbUpdate(`/orders/${id}`, patch);
        } catch (e) {
          aviso('No se pudo marcar como servido — revisa la conexión');
        } finally {
          marcandoServido.delete(key);
        }
      }

      /* ═══════════ RENDER ═══════════ */
      function render() {
        const el = document.getElementById('app');
        if (state.cargandoSesion) {
          el.innerHTML = renderCargando();
          return;
        }
        el.innerHTML = renderApp();
        bindApp();
        if (window.actualizarBotonInstalarPWA) window.actualizarBotonInstalarPWA();
        if (state.toast) {
          const t = document.createElement('div');
          t.className = 'toast';
          t.textContent = state.toast;
          document.body.appendChild(t);
          setTimeout(() => t.remove(), 2600);
        }
      }

      function renderCargando() {
        return `
  <div class="auth-wrap">
    <div class="auth-logo"><img src="../icons/icon-192.png" alt="Rodizio"></div>
    <h1 class="auth-title">Rodizio</h1>
    <div class="spinner"></div>
    <p class="auth-sub">Verificando sesión…</p>
  </div>`;
      }

      function renderApp() {
        const activos = Object.values(state.pedidos).filter(
          (p) => p && p.mesero === state.mesero && statusDe(p) !== "entregado",
        );
        const listos = Object.values(state.pedidos).filter(
          (p) => p && p.mesero === state.mesero && statusDe(p) === "listo",
        );
        const nombreMesa = nombreMesaActual();
        return `
  <div class="topbar">
    <img class="brand-logo" src="../icons/logo-blanco.webp" alt="Rodízio" height="24">
    <div class="who"><b>${escapeHtml(state.mesero)}</b><span>${nombreMesa ? escapeHtml(nombreMesa) : 'Sin mesa'} · @${escapeHtml(state.perfil.usuario || '')}</span></div>
    <button class="btn-instalar-pwa" id="btnInstalarApp"><svg class="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>Instalar</button>
    <button class="logout" id="btnSalir">Salir</button>
  </div>
  <div class="tabs">
    <button class="tab ${state.tab === 'mesas' ? 'on' : ''}" id="tabMesas">Mesas</button>
    <button class="tab ${state.tab === 'pedidos' ? 'on' : ''}" id="tabPedidos">Pedidos ${activos.length ? '· ' + activos.length : ''}</button>
  </div>
  <p class="connbar">${state.conectado ? '● Conectado con cocina' : '○ Conectando con cocina…'}</p>
  ${listos.length ? `<button class="listos-banner" id="btnVerListos"><span class="material-symbols-outlined">notifications</span> ${listos.length === 1 ? '1 pedido listo' : listos.length + ' pedidos listos'} · ${listos.map((p) => escapeHtml(p.mesa)).join(', ')} — toca para ver</button>` : ''}
  <main>${state.tab === 'mesas' ? renderMesas() : state.tab === 'menu' ? (nombreMesa ? renderMenu() : renderSinMesa()) : renderPedidos()}</main>
  ${state.tab === 'menu' && nombreMesa && state.carrito.length && !state.comandaAbierta ? renderCartBar() : ''}
  ${renderDrawer()}
  `;
      }
      function renderSinMesa() {
        return `<div class="empty-state">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>
    <p>Elige una mesa en la pestaña "Mesas" para empezar a tomar el pedido</p>
    <button class="cta" id="btnIrAMesas" style="margin-top:16px">Ver mesas</button>
  </div>`;
      }
      function renderMesas() {
        const mesasOrdenadas = Object.entries(state.mesas)
          .filter(([, m]) => m && m.activa !== false)
          .sort((a, b) => {
            const nomA = String(a[1].nombre || '');
            const nomB = String(b[1].nombre || '');
            const numA = parseInt(nomA.replace(/\D/g, ''));
            const numB = parseInt(nomB.replace(/\D/g, ''));
            if (!isNaN(numA) && !isNaN(numB) && numA !== numB)
              return numA - numB;
            return nomA.localeCompare(nomB, 'es', { numeric: true });
          });

        return `<div class="mesas-grid">
    ${mesasOrdenadas
      .map(([id, m]) => {
        const ocupada = mesaOcupada(id);
        const pendiente = solicitudPendiente(id);
        return `<button class="mesa-card ${id === state.mesaId ? 'elegida' : ''} ${ocupada ? 'ocupada' : ''} ${pendiente ? 'con-solicitud' : ''}" data-id="${id}">
        ${pendiente ? '<span class="mesa-solicitud-badge material-symbols-outlined">restaurant</span>' : ''}
        <b>${escapeHtml(m.nombre)}</b>
        <small>${pendiente ? 'Pedido del cliente' : ocupada ? 'Ocupada' : 'Libre'}</small>
      </button>`;
      })
      .join('')}
    <button class="mesa-card" style="border:1.5px dashed var(--color-divider);background:transparent" id="btnNuevaMesa">
      <b style="font-size:20px;line-height:1;margin-bottom:2px">+</b>
      <small>Abrir otra</small>
    </button>
  </div>`;
      }
      // Quita acentos para búsqueda flexible
      function sinAcentos(s) {
        return s
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();
      }

      function renderMenu() {
        const enCarrito = {};
        state.carrito.forEach((l) => (enCarrito[l.id] = l.qty));
        const termino = sinAcentos(state.busqueda || '').trim();
        const buscando = termino.length >= 2;

        // Si está buscando, mostrar resultados de TODAS las categorías
        let items = [];
        if (buscando) {
          MENU.forEach((g) =>
            g.items.forEach((it) => {
              if (
                sinAcentos(it.nombre).includes(termino) ||
                sinAcentos(it.desc).includes(termino)
              ) {
                items.push({ ...it, catLabel: g.cat });
              }
            }),
          );
        } else {
          const grupo = MENU.find((g) => g.cat === state.cat) || MENU[0];
          items = grupo.items.map((it) => ({ ...it, catLabel: null }));
        }

        const editandoLabel = state.editandoPedidoId
          ? `<div style="background:var(--color-accent-100);border:1px solid var(--color-accent-300);border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--color-accent-700)">
        <div style="font-weight:700;display:inline-flex;align-items:center;gap:5px"><span class="material-symbols-outlined">edit</span>Editando pedido</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button id="btnCancelarEdicion" style="border:1px solid var(--color-accent-300);background:transparent;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:600;color:var(--color-accent-700);cursor:pointer">Cancelar edición</button>
          <button id="btnCancelarPedidoEdicion" style="border:1px solid var(--marca-texto);background:transparent;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:600;color:var(--marca-texto);cursor:pointer">Eliminar pedido</button>
        </div>
      </div>`
          : '';

        const solicitud = solicitudPendiente(state.mesaId);
        const solicitudBanner = solicitud
          ? `<div style="background:var(--color-accent-2-100);border:1px solid var(--color-accent-2-500);border-radius:14px;padding:14px;margin-bottom:12px">
        <div style="font-weight:700;color:var(--color-accent-2-700);display:flex;align-items:center;gap:6px;margin-bottom:8px"><span class="material-symbols-outlined">restaurant</span>Pedido${solicitud.cliente ? ' de ' + escapeHtml(solicitud.cliente) : ' del cliente'} esperando confirmación</div>
        <div style="font-size:12.5px;color:var(--color-neutral-700);display:flex;flex-direction:column;gap:2px">
          ${solicitud.lineas.map((l) => `<span>${l.qty}× ${escapeHtml(l.nombre)}${l.nota ? ' — ' + escapeHtml(l.nota) : ''}</span>`).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-ghost" id="btnDescartarSolicitud" style="flex:1">Descartar</button>
          <button class="btn-send" id="btnConfirmarSolicitud" style="flex:2">Confirmar pedido</button>
        </div>
      </div>`
          : '';

        return `
  ${editandoLabel}
  ${solicitudBanner}
  <div class="menu-search-wrap">
    <svg class="menu-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
    <input class="menu-search" id="menuSearch" type="text" placeholder="Buscar producto…" value="${escapeHtml(state.busqueda)}">
    ${state.busqueda ? '<button class="menu-search-clear" id="menuSearchClear"><span class="material-symbols-outlined">close</span></button>' : ''}
  </div>
  ${!buscando ? `<div class="cats">${CATS.map((c) => `<button class="cat-pill ${c === state.cat ? 'on' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}</div>` : ''}
  ${items.length === 0 && buscando ? '<div class="empty-state" style="padding:30px 0"><p>No se encontraron productos con "' + escapeHtml(state.busqueda) + '"</p></div>' : ''}
  ${items
    .map((it) => {
      const q = enCarrito[it.id] || 0;
      return `<div class="plato ${q > 0 ? 'in' : ''}">
      <div class="plato-info">
        ${it.catLabel ? `<span class="plato-cat">${escapeHtml(it.catLabel)}</span>` : ''}
        <b>${escapeHtml(it.nombre)}</b><small>${escapeHtml(it.desc)}</small><span class="precio">${cop(it.precio)}</span>
      </div>
      <div class="stepper">
        ${q > 0 ? `<button data-quitar="${it.id}">–</button><span class="qty">${q}</span>` : ''}
        <button class="add" data-agregar="${it.id}">+</button>
      </div>
    </div>`;
    })
    .join('')}`;
      }
      function renderCartBar() {
        const unidades = state.carrito.reduce((n, l) => n + l.qty, 0);
        return `<button class="cart-bar" id="btnAbrirComanda"><b>${unidades} ítem${unidades === 1 ? '' : 's'}</b><span>${cop(total())}</span><span class="cta-mini">Ver comanda</span></button>`;
      }
      function renderDrawer() {
        const abierta = state.comandaAbierta;
        const lineas =
          state.carrito
            .map((l) => {
              const it = ITEM_INDEX[l.id];
              const sug = sugerenciasParaItem(it);
              return `<div class="linea-row">
      <div class="linea-top">
        <b>${escapeHtml(it.nombre)}</b>
        <div class="stepper"><button data-quitar="${it.id}">–</button><span class="qty">${l.qty}</span><button class="add" data-agregar="${it.id}">+</button></div>
        <span class="sub">${cop(it.precio * l.qty)}</span>
      </div>
      ${sug.length ? `<div class="sug">${sug.map((t) => `<button class="${notaPartes(l.nota).includes(t) ? 'on' : ''}" data-nota-chip="${it.id}" data-texto="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</div>` : ''}
      <input class="nota-input" placeholder="Nota para cocina (opcional)" data-nota="${it.id}" value="${escapeHtml(l.nota || '')}">
    </div>`;
            })
            .join('') ||
          `<p style="text-align:center;color:var(--color-neutral-500);padding:30px 0">Tu comanda está vacía</p>`;
        return `
  <div class="backdrop ${abierta ? 'show' : ''}" id="backdrop"></div>
  <div class="drawer ${abierta ? 'show' : ''}">
    <div class="drawer-head"><h3>Comanda · ${escapeHtml(nombreMesaActual() || '')}</h3><button class="drawer-close" id="btnCerrarDrawer"><span class="material-symbols-outlined">close</span></button></div>
    <div class="drawer-body">${lineas}</div>
    <div class="drawer-foot">
      <div class="drawer-total"><span>Total</span><span>${cop(total())}</span></div>
      <div class="drawer-actions">
        <button class="btn-ghost" id="btnVaciar">Vaciar</button>
        <button class="btn-send" id="btnEnviar" ${state.carrito.length && !state.enviando ? '' : 'disabled'}>${state.enviando ? 'Enviando…' : 'Enviar a cocina'}</button>
      </div>
    </div>
  </div>`;
      }
      // agruparPorRonda viene de ../shared/util.js (compartida con panel-cocina).
      function renderPedidos() {
        const mios = Object.entries(state.pedidos)
          .filter(([, p]) => p && p.mesero === state.mesero && statusDe(p) !== "cancelado")
          .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
        if (!mios.length) {
          return `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/></svg><p>Aún no has enviado comandas en este turno</p></div>`;
        }
        return mios
          .map(([id, p]) => {
            const idx = ESTADOS.indexOf(statusDe(p));
            const min = Math.max(0, Math.round((Date.now() - p.ts) / 60000));
            // Mismos tonos de estado que caja (sistema "Rodízio Brasa"): en
            // cocina = ámbar, listo = verde, servido = neutro. El rojo queda
            // para las acciones, no para el estado.
            const color =
              statusDe(p) === "listo"
                ? 'var(--exito)'
                : statusDe(p) === "entregado"
                  ? 'var(--tinta-suave)'
                  : 'var(--aviso)';
            const tinte =
              statusDe(p) === "listo"
                ? 'var(--exito-tinte)'
                : statusDe(p) === "entregado"
                  ? 'var(--superficie-hundida)'
                  : 'var(--aviso-tinte)';
            const pasos = ['Enviado', 'En preparación', 'Listo', 'Servido'];
            // Editar/cancelar solo para pedidos de una sola ronda en estado
            // "enviado" — una vez que cocina lo toma ("preparacion" en
            // adelante) o se agregó una ronda nueva, ya no se puede
            // deshacer/reemplazar el pedido entero desde acá (ver
            // editarPedido más arriba).
            const btnEditar =
              statusDe(p) === "enviado" && (!p.rondaActual || p.rondaActual === 1)
                ? `<div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-servir" style="background:var(--color-accent);flex:2;margin-top:0" data-editar="${id}"><span class="material-symbols-outlined">edit</span>Editar pedido</button>
              <button class="btn-servir" style="background:transparent;border:1px solid var(--color-divider);color:var(--marca-texto);flex:1;margin-top:0" data-cancelar="${id}"><span class="material-symbols-outlined">delete</span>Cancelar</button>
            </div>`
                : '';
            // Ya en "preparacion"/"listo" no se puede editar/cancelar en
            // silencio — solo avisar a cocina para coordinar en persona.
            const btnAviso =
              statusDe(p) === "preparacion" || statusDe(p) === "listo"
                ? p.avisoCambio
                  ? `<p style="font-size:11.5px;color:var(--color-neutral-500);margin-top:10px;text-align:center">Aviso enviado — esperando a cocina</p>`
                  : `<button class="btn-servir" style="background:transparent;border:1px solid var(--color-divider);color:var(--color-neutral-700);margin-top:12px" data-avisar="${id}"><span class="material-symbols-outlined">campaign</span>Avisar cambio a cocina</button>`
                : '';
            // Cada ronda avanza y se sirve por separado (ver
            // estadoEfectivoTicket/estadoDeRonda en shared/util.js) — el
            // mesero puede recoger la ronda 1 en cuanto esté lista sin
            // esperar a que la ronda 2 también lo esté.
            const grupos = agruparPorRonda(p.lineas, p.rondas);
            const lineasHtml = grupos
              .map((g) => {
                const estadoRonda = estadoDeRonda(p, g.ronda);
                const accionRonda =
                  estadoRonda === 'listo'
                    ? `<button class="btn-servir-ronda" data-servir="${id}" data-ronda="${g.ronda}">Marcar servido</button>`
                    : estadoRonda === 'entregado'
                      ? `<span class="p-ronda-estado servido"><span class="material-symbols-outlined">check_circle</span>Servido</span>`
                      : estadoRonda === 'preparacion'
                        ? `<span class="p-ronda-estado en-prep">En preparación</span>`
                        : `<span class="p-ronda-estado">Enviado</span>`;
                const header = `<div class="p-ronda-header${g.ronda > 1 ? ' ronda-sep' : ''}">
              <span>${g.ronda === 1 ? 'Pedido inicial' : 'Ronda ' + g.ronda}${g.ts ? ' · hace ' + Math.max(0, Math.round((Date.now() - g.ts) / 60000)) + ' min' : ''}</span>
              ${accionRonda}
            </div>`;
                const lineas = g.lineas
                  .map(
                    (l) =>
                      `<div class="p-linea"><span class="desc">${l.qty}× ${escapeHtml(l.nombre)}${l.nota ? `<span class="nota">${escapeHtml(l.nota)}</span>` : ''}</span><span>${cop(l.precio * l.qty)}</span></div>`,
                  )
                  .join('');
                return header + lineas;
              })
              .join('');
            return `<div class="pedido-card ${statusDe(p) === "listo" ? 'listo' : ''}">
      <div class="p-top"><span class="p-mesa">${escapeHtml(String(p.mesa ?? '—'))}</span><span class="p-badge" style="background:${tinte};color:${color}">${escapeHtml(ETIQUETA[statusDe(p)] || statusDe(p))}</span></div>
      <p class="p-meta">${escapeHtml(p.codigo || id)} · hace ${min} min · ${(p.lineas || []).reduce((n, l) => n + l.qty, 0)} ítems</p>
      <div class="pasos">${pasos.map((nombre, i) => `<div><div class="paso-bar" style="background:${i <= idx ? color : 'var(--color-neutral-300)'}"></div><div class="paso-label" style="color:${i <= idx ? 'var(--color-neutral-800)' : 'var(--color-neutral-500)'}">${nombre}</div></div>`).join('')}</div>
      <div class="p-lineas">${lineasHtml}</div>
      <div class="p-total"><span>Total</span><span>${cop(p.total)}</span></div>
      ${btnEditar}
      ${btnAviso}
    </div>`;
          })
          .join('');
      }

      function bindApp() {
        // Guardar carrito antes de cambiar de pestaña
        document.getElementById('tabMesas').onclick = () => {
          guardarCarritoMesa();
          setState({ tab: 'mesas' });
        };
        document.getElementById('tabPedidos').onclick = () => {
          guardarCarritoMesa();
          setState({ tab: 'pedidos' });
        };
        const btnVerListos = document.getElementById('btnVerListos');
        if (btnVerListos)
          btnVerListos.onclick = () => {
            guardarCarritoMesa();
            setState({ tab: 'pedidos' });
          };
        const btnIrAMesas = document.getElementById('btnIrAMesas');
        if (btnIrAMesas)
          btnIrAMesas.onclick = () => {
            guardarCarritoMesa();
            setState({ tab: 'mesas' });
          };

        document
          .querySelectorAll('.mesa-card[data-id]')
          .forEach((b) => (b.onclick = () => elegirMesa(b.dataset.id)));
        const btnNueva = document.getElementById('btnNuevaMesa');
        if (btnNueva) {
          btnNueva.onclick = () => {
            const nom = prompt(
              'Nombre o número para la nueva mesa (Ej: Mesa 21, Terraza, etc):',
            );
            const nombre = (nom || '').trim();
            const id = slugMesa(nombre);
            if (id) {
              // Mismo id que generaría el QR del panel-admin para ese
              // nombre (slugMesa en shared/util.js) — así una mesa abierta
              // a mano y su QR impreso caen en la MISMA mesa, sin duplicar.
              state.mesas[id] = { nombre, activa: true };
              elegirMesa(id);
            }
          };
        }

        document.getElementById('btnSalir').onclick = salir;

        // Buscador de menú — actualiza sin re-renderizar en cada tecla
        // para no perder foco del teclado en móvil
        const menuSearch = document.getElementById('menuSearch');
        if (menuSearch) {
          menuSearch.oninput = (e) => {
            state.busqueda = e.target.value;
            // Debounce: solo re-renderizar después de parar de escribir
            clearTimeout(window.__searchT);
            window.__searchT = setTimeout(() => render(), 200);
          };
          // Enfocar el campo si ya tenía texto (post re-render)
          if (state.busqueda) {
            menuSearch.focus();
            menuSearch.setSelectionRange(
              menuSearch.value.length,
              menuSearch.value.length,
            );
          }
        }
        const menuSearchClear = document.getElementById('menuSearchClear');
        if (menuSearchClear)
          menuSearchClear.onclick = () => setState({ busqueda: '' });

        // Cancelar edición
        const btnCancelarEdicion =
          document.getElementById('btnCancelarEdicion');
        if (btnCancelarEdicion)
          btnCancelarEdicion.onclick = () => {
            limpiarCarritoMesa(state.mesaId);
            setState({ carrito: [], editandoPedidoId: null });
          };

        const btnConfirmarSolicitud = document.getElementById(
          'btnConfirmarSolicitud',
        );
        if (btnConfirmarSolicitud)
          btnConfirmarSolicitud.onclick = () => confirmarSolicitud(state.mesaId);
        const btnDescartarSolicitud = document.getElementById(
          'btnDescartarSolicitud',
        );
        if (btnDescartarSolicitud)
          btnDescartarSolicitud.onclick = () => descartarSolicitud(state.mesaId);

        document
          .querySelectorAll('[data-cat]')
          .forEach(
            (b) =>
              (b.onclick = () =>
                setState({ cat: b.dataset.cat, busqueda: '' })),
          );
        document
          .querySelectorAll('[data-agregar]')
          .forEach((b) => (b.onclick = () => cambiar(b.dataset.agregar, 1)));
        document
          .querySelectorAll('[data-quitar]')
          .forEach((b) => (b.onclick = () => cambiar(b.dataset.quitar, -1)));

        const abrir = document.getElementById('btnAbrirComanda');
        if (abrir) abrir.onclick = () => setState({ comandaAbierta: true });
        const backdrop = document.getElementById('backdrop');
        if (backdrop)
          backdrop.onclick = () => setState({ comandaAbierta: false });
        const cerrarD = document.getElementById('btnCerrarDrawer');
        if (cerrarD)
          cerrarD.onclick = () => setState({ comandaAbierta: false });
        const vaciar = document.getElementById('btnVaciar');
        if (vaciar)
          vaciar.onclick = () => {
            limpiarCarritoMesa(state.mesaId);
            setState({
              carrito: [],
              comandaAbierta: false,
              editandoPedidoId: null,
              clienteNombre: null,
            });
          };
        const btnEnviar = document.getElementById('btnEnviar');
        if (btnEnviar) btnEnviar.onclick = enviar;

        // Igual que en los campos de auth: la nota se escribe sin re-renderizar
        // en cada tecla, para no perder el foco del teclado en móvil.
        document.querySelectorAll('[data-nota]').forEach(
          (inp) =>
            (inp.oninput = (e) => {
              const linea = state.carrito.find(
                (l) => l.id === inp.dataset.nota,
              );
              if (linea) linea.nota = e.target.value;
            }),
        );
        document.querySelectorAll('[data-nota-chip]').forEach(
          (b) =>
            (b.onclick = () =>
              alternarSugerencia(b.dataset.notaChip, b.dataset.texto)),
        );
        document
          .querySelectorAll('[data-servir]')
          .forEach((b) => (b.onclick = () => marcarServido(b.dataset.servir, b.dataset.ronda)));
        // Editar/cancelar pedido desde la vista de pedidos
        document
          .querySelectorAll('[data-editar]')
          .forEach((b) => (b.onclick = () => editarPedido(b.dataset.editar)));
        document
          .querySelectorAll('[data-cancelar]')
          .forEach((b) => (b.onclick = () => cancelarPedido(b.dataset.cancelar)));
        document
          .querySelectorAll('[data-avisar]')
          .forEach((b) => (b.onclick = () => avisarCambioCocina(b.dataset.avisar)));
        const btnCancelarPedidoEdicion = document.getElementById(
          'btnCancelarPedidoEdicion',
        );
        if (btnCancelarPedidoEdicion)
          btnCancelarPedidoEdicion.onclick = () =>
            cancelarPedido(state.editandoPedidoId);
      }

      render();
      iniciarSesion();
