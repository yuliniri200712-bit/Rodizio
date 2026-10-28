/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* ─────────────────────────────────────────────────────────────
       Rodizio · Login raíz — punto de entrada único del sistema.
       Autentica con Firebase Authentication (shared/auth.js), lee el
       perfil del trabajador en /trabajadores/{uid} (shared/roles.js) y
       redirige a la app que le corresponde según su rol. Si tiene más
       de un rol permitido, deja elegir con cuál entra hoy.
       ───────────────────────────────────────────────────────────── */

    // Carpeta de cada app según el rol.
    const RUTA_POR_ROL = {
      admin: "panel-admin/",
      mesero: "mesero-app/",
      cajero: "panel-caja/",
      cocinero: "panel-cocina/"
    };
    const NOMBRE_ROL = { admin: "Administrador", mesero: "Mesero", cajero: "Caja", cocinero: "Cocina" };

    // Cada panel se despliega en su propio sitio de Firebase Hosting
    // (rodizio-admin, rodizio-mesero, rodizio-caja, rodizio-cocina).
    // Si el login corre en uno de esos sitios dedicados, no tiene sentido
    // ofrecer los otros paneles: se entra directo al único que existe ahí.
    // En localhost o en un sitio combinado, `null` => se muestra el elegidor.
    function panelDedicado() {
      const h = (location.hostname || "").toLowerCase();
      if (h.includes("admin")) return "admin";
      if (h.includes("mesero") || h.includes("mesa")) return "mesero";
      if (h.includes("caja")) return "cajero";
      if (h.includes("cocina")) return "cocinero";
      return null;
    }

    const $ = (id) => document.getElementById(id);

    function mostrar(id) {
      ["formLogin", "vistaRoles", "vistaCargando"].forEach((otro) => $(otro).classList.toggle("hidden", otro !== id));
    }

    function mostrarError(msg) {
      const el = $("errLogin");
      el.textContent = msg;
      el.classList.remove("hidden");
    }
    function limpiarError() {
      $("errLogin").classList.add("hidden");
    }

    // Espera a que shared/auth.js (módulo ES) haya colgado sus funciones
    // en window antes de usarlas — se cargan casi al instante, pero por
    // las dudas en conexiones lentas.
    function esperarAuthListo() {
      return new Promise((resolve) => {
        (function chequear() {
          if (window.login && window.onAuthStateChanged && window.dbGet) resolve();
          else setTimeout(chequear, 30);
        })();
      });
    }

    async function irARol(rol) {
      const ruta = RUTA_POR_ROL[rol];
      if (!ruta) {
        mostrarError(`El panel de "${NOMBRE_ROL[rol] || rol}" todavía no está disponible. Habla con el administrador.`);
        return;
      }
      setActiveRole(rol);
      window.location.href = ruta;
    }

    async function despuesDeLogin(user) {
      let perfil;
      try {
        perfil = await getWorkerProfile(user.uid);
      } catch (e) {
        mostrarError("No se pudo verificar tu cuenta — revisa tu conexión.");
        mostrar("formLogin");
        return;
      }

      if (!perfil) {
        mostrarError("Tu cuenta no está registrada en el sistema. Contacta al administrador.");
        await logout();
        mostrar("formLogin");
        return;
      }
      if (perfil.estado && perfil.estado !== "activo") {
        mostrarError("Tu cuenta está desactivada. Contacta al administrador.");
        await logout();
        mostrar("formLogin");
        return;
      }

      // Cualquier trabajador activo puede operar mesero, caja o cocina — el
      // rol real lo define el panel/dispositivo en el que trabaje hoy, no
      // una lista fija que el admin tenga que ir reasignando turno a turno.
      // "admin" sigue siendo el único rol que hay que asignar explícitamente
      // (desde panel-admin), porque da acceso a gestionar trabajadores.
      let opciones = ["mesero", "cajero", "cocinero"];
      if (hasRole(perfil, "admin")) opciones.unshift("admin");

      // Sitio dedicado a un solo panel: entrar directo a ese.
      const fijo = panelDedicado();
      if (fijo) {
        if (fijo === "admin" && !hasRole(perfil, "admin")) {
          mostrarError("Este panel es solo para administradores. Contacta al administrador.");
          await logout();
          mostrar("formLogin");
          return;
        }
        irARol(fijo);
        return;
      }

      if (opciones.length === 1) {
        irARol(opciones[0]);
        return;
      }

      // Varias opciones (el caso normal): dejar elegir con cuál entra hoy.
      $("bienvenida").textContent = "Hola, " + (perfil.nombre ? perfil.nombre.split(" ")[0] : "de nuevo");
      $("listaRoles").innerHTML = opciones.map((rol) => `
    <button class="rol-btn" data-rol="${rol}">${NOMBRE_ROL[rol] || rol}</button>`).join("");
      document.querySelectorAll(".rol-btn").forEach((b) => b.onclick = () => irARol(b.dataset.rol));
      mostrar("vistaRoles");
    }

    async function iniciar() {
      await esperarAuthListo();
      mostrar("vistaCargando");

      onAuthStateChanged(async (user) => {
        if (user) {
          await despuesDeLogin(user);
        } else {
          mostrar("formLogin");
        }
      });

      $("formLogin").addEventListener("submit", async (e) => {
        e.preventDefault();
        limpiarError();
        const usuario = $("fUsuario").value.trim();
        const password = $("fPassword").value;
        if (!usuario || !password) { mostrarError("Escribe tu usuario y contraseña."); return; }

        const btn = $("btnEntrar");
        btn.disabled = true; btn.textContent = "Entrando…";
        try {
          await login(usuario, password);
          // onAuthStateChanged se dispara solo y sigue el flujo desde ahí.
        } catch (err) {
          const code = err && err.code;
          let msg = "No se pudo iniciar sesión.";
          if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
            msg = "Usuario o contraseña incorrectos.";
          } else if (code === "auth/too-many-requests") {
            msg = "Demasiados intentos — espera un momento e intenta de nuevo.";
          } else if (code === "auth/network-request-failed") {
            msg = "Sin conexión — revisa tu internet.";
          }
          mostrarError(msg);
          btn.disabled = false; btn.textContent = "Entrar";
        }
      });

      $("btnCancelar").addEventListener("click", async () => {
        await logout();
        mostrar("formLogin");
        $("fPassword").value = "";
      });
    }

    iniciar();