/* Red de seguridad de la carga inicial (script clásico, sin imports).
   js/app.js es un módulo que depende de ~16 archivos y de los SDK de
   Firebase en gstatic: si cualquiera falla (red mala, un bloqueador de
   anuncios, gstatic caído) el módulo nunca corre, y el splash quedaba
   tapando la pantalla para siempre. Este archivo no depende de nada:
   si app.js no arrancó a tiempo, quita el splash y avisa con un botón
   para reintentar. app.js marca window.__rodizioArranco al empezar. */
(function () {
  var ESPERA_MS = 10000;

  setTimeout(function () {
    if (window.__rodizioArranco) return;

    var splash = document.getElementById('splash');
    if (splash) splash.classList.add('is-hidden');

    var aviso = document.createElement('div');
    aviso.setAttribute('role', 'alert');
    aviso.style.cssText =
      'position:fixed;left:16px;right:16px;top:50%;transform:translateY(-50%);z-index:100000;' +
      'max-width:420px;margin:0 auto;padding:24px;border-radius:16px;text-align:center;' +
      'background:#fff;color:#1b1b1b;box-shadow:0 12px 40px rgba(0,0,0,.35);font:16px/1.4 system-ui,sans-serif;';
    aviso.innerHTML =
      '<p style="margin:0 0 16px;font-weight:700">No pudimos cargar la tienda.</p>' +
      '<p style="margin:0 0 20px">Revisa tu conexión a internet e inténtalo de nuevo.</p>';
    var boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = 'Reintentar';
    boton.style.cssText =
      'min-height:44px;padding:10px 28px;border:0;border-radius:999px;background:#b3261e;color:#fff;font:700 16px system-ui,sans-serif;cursor:pointer;';
    boton.addEventListener('click', function () {
      location.reload();
    });
    aviso.appendChild(boton);
    document.body.appendChild(aviso);
  }, ESPERA_MS);
})();
