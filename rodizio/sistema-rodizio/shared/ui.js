/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* shared/ui.js - Lógica compartida de interfaz de usuario */

(function(global) {
  // Manejo centralizado de notificaciones (Toasts)
  let __toastT;
  
  // opts.icono: nombre de un ícono de Material Symbols (ej. "notifications"),
  // opcional. Se arma con dos nodos de texto separados (nunca innerHTML) para
  // que "mensaje" —que a veces trae datos como el nombre de una mesa— jamás
  // se interprete como HTML, sin importar qué caracteres traiga.
  global.mostrarToast = function(mensaje, opts) {
    opts = opts || {};
    let t = document.getElementById("global-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "global-toast";
      document.body.appendChild(t);
    }

    t.className = "";
    void t.offsetWidth; // trigger reflow

    t.className = "toast";
    t.textContent = "";
    if (opts.icono) {
      const ic = document.createElement("span");
      ic.className = "material-symbols-outlined toast-icon";
      ic.textContent = opts.icono;
      t.appendChild(ic);
    }
    t.appendChild(document.createTextNode(mensaje));

    clearTimeout(__toastT);
    __toastT = setTimeout(() => {
      t.className = "";
      t.textContent = "";
    }, opts.duracion || 2600);
  };

  // Manejo de la instalación de PWA independiente por panel
  let deferredPrompt = null;

  // Detecta si esta pestaña ya se está ejecutando como app instalada:
  // display-mode "standalone" (Android/desktop) o navigator.standalone
  // (iOS Safari, siempre en minúscula, no confundir con display-mode).
  function appYaInstalada() {
    if (global.matchMedia && global.matchMedia("(display-mode: standalone)").matches) return true;
    if (global.navigator && global.navigator.standalone === true) return true;
    return false;
  }

  function esIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !global.MSStream;
  }

  global.actualizarBotonInstalarPWA = function() {
    const btns = document.querySelectorAll(".btn-instalar-pwa");
    btns.forEach(btn => {
      if (appYaInstalada()) {
        // Ya está instalada en este dispositivo: deja el botón visible pero
        // deshabilitado en vez de ocultarlo, así se entiende por qué no hace nada.
        btn.style.display = "inline-flex";
        btn.disabled = true;
        btn.title = "Ya está instalada en este dispositivo";
        btn.onclick = null;
      } else if (deferredPrompt) {
        btn.style.display = "inline-flex";
        btn.disabled = false;
        btn.title = "";
        btn.onclick = async () => {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          // El prompt es de un solo uso tanto si se acepta como si se rechaza.
          // Si se aceptó, "appinstalled" ya se encarga de refrescar el botón;
          // si se rechazó, hay que ocultarlo aquí porque no quedó nada que ofrecer.
          deferredPrompt = null;
          global.actualizarBotonInstalarPWA();
        };
      } else if (esIOS()) {
        btn.style.display = "inline-flex";
        btn.disabled = false;
        btn.textContent = "Añadir a inicio";
        btn.title = "En Safari: Compartir y Añadir a pantalla de inicio";
        btn.onclick = () => global.mostrarToast("En Safari toca Compartir y luego Añadir a pantalla de inicio", { duracion: 5000 });
      } else {
        btn.style.display = "none";
      }
    });
  };

  global.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    global.actualizarBotonInstalarPWA();
  });

  // Se dispara justo al terminar de instalarse (independiente de por dónde
  // se instaló: nuestro botón, el menú del navegador, etc.) — deshabilita
  // el botón de inmediato sin esperar a que se vuelva a llamar render().
  global.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    global.actualizarBotonInstalarPWA();
  });

  document.addEventListener("DOMContentLoaded", () => {
    if (appYaInstalada()) global.actualizarBotonInstalarPWA();
  });

  /* ───────── Modo observación (solo lectura) ─────────
     Lo activa mesero-app / panel-caja / panel-cocina cuando entra un
     usuario con rol "admin": puede VER todo en vivo pero no modificar
     nada. La barrera real es `window.__SOLO_LECTURA`, que shared/firebase.js
     revisa antes de CADA escritura (dbSet/dbUpdate/dbDelete/dbPush/
     siguienteCodigo) y la convierte en no-op. Esto de acá solo comunica
     el estado: un distintivo fijo + un toast cuando se intenta tocar algo.
     Idempotente — llamarlo dos veces no duplica nada. */
  let __avisoObsT = 0;
  global.activarModoObservador = function (etiqueta) {
    global.__SOLO_LECTURA = true;

    global.__avisoSoloLectura = function () {
      const ahora = Date.now();
      if (ahora - __avisoObsT < 2500) return;   // no spamear
      __avisoObsT = ahora;
      global.mostrarToast("Modo observación — no puedes modificar nada.", { icono: "visibility" });
    };

    function pintar() {
      if (!document.body) return;
      document.body.classList.add("solo-lectura");
      if (document.getElementById("obs-badge")) return;
      const b = document.createElement("div");
      b.id = "obs-badge";
      const ic = document.createElement("span");
      ic.className = "material-symbols-outlined";
      ic.textContent = "visibility";
      b.appendChild(ic);
      b.appendChild(document.createTextNode(
        "Solo observación" + (etiqueta ? " · " + etiqueta : "")
      ));
      document.body.appendChild(b);
    }
    if (document.body) pintar();
    else document.addEventListener("DOMContentLoaded", pintar);
  };
})(window);
