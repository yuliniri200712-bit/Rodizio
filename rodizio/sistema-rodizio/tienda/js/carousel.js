/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   Carrusel de promociones y fotos de referencia (Hero Slider)
   Bucle infinito real con clones, arrastre interactivo (táctil y mouse),
   inercia fluida y sincronización de dots y flechas.
   ========================================================= */
(function () {
  'use strict';

  function initHeroSlider() {
    var outerContainer = document.getElementById('hero-banners-container');
    var slider = document.getElementById('hero-banners-slider');
    var dotsContainer = document.getElementById('hero-banner-dots');
    var prevBtn = document.getElementById('hero-arrow-prev');
    var nextBtn = document.getElementById('hero-arrow-next');
    if (!outerContainer || !slider) return;

    var originalSlides = Array.prototype.slice.call(slider.querySelectorAll('.hero-banner-card'));
    var dots = dotsContainer ? Array.prototype.slice.call(dotsContainer.querySelectorAll('.banner-dot')) : [];
    var N = originalSlides.length;
    if (N <= 1) return;

    // Buffer de clones: 2 clones al inicio y 2 clones al final
    var BUFFER = 2;
    // Clones al inicio (los últimos 2 originales)
    var cloneBefore1 = originalSlides[N - 2].cloneNode(true);
    var cloneBefore2 = originalSlides[N - 1].cloneNode(true);
    cloneBefore1.classList.add('is-clone');
    cloneBefore2.classList.add('is-clone');
    slider.insertBefore(cloneBefore2, slider.firstChild);
    slider.insertBefore(cloneBefore1, slider.firstChild);

    // Clones al final (los primeros 2 originales)
    var cloneAfter1 = originalSlides[0].cloneNode(true);
    var cloneAfter2 = originalSlides[1].cloneNode(true);
    cloneAfter1.classList.add('is-clone');
    cloneAfter2.classList.add('is-clone');
    slider.appendChild(cloneAfter1);
    slider.appendChild(cloneAfter2);

    // Todos los slides en el track (N + 4)
    var allSlides = Array.prototype.slice.call(slider.querySelectorAll('.hero-banner-card'));

    var virtualIndex = BUFFER; // Inicia en 2 (Slide 0)
    var timer = null;
    var isDragging = false;
    var startX = 0;
    var startY = 0;
    var currentX = 0;
    var currentY = 0;
    var startTime = 0;
    var isSwipingHorizontal = null;
    var draggedFar = false;
    var isAnimating = false;

    function getContainerWidth() {
      return outerContainer.getBoundingClientRect().width || outerContainer.offsetWidth || 360;
    }

    function setTrackPosition(px, animate, durationMs) {
      if (animate) {
        slider.style.transition = 'transform ' + (durationMs || 400) + 'ms cubic-bezier(0.22, 1, 0.36, 1)';
      } else {
        slider.style.transition = 'none';
      }
      slider.style.transform = 'translate3d(' + px + 'px, 0, 0)';
    }

    function getRealIndex(vIndex) {
      return ((vIndex - BUFFER) % N + N) % N;
    }

    function updateActiveState() {
      var realIdx = getRealIndex(virtualIndex);

      allSlides.forEach(function (slide, idx) {
        if (idx === virtualIndex) {
          slide.classList.add('is-active');
        } else {
          slide.classList.remove('is-active');
        }
      });

      dots.forEach(function (dot, idx) {
        if (idx === realIdx) {
          dot.classList.add('is-active');
        } else {
          dot.classList.remove('is-active');
        }
      });
    }

    /* La entrada escalonada del contenido se hace SOLO con CSS
       (keyframe heroContentIn en brand.css, atado a .is-active) — es
       robusta ante pestaña en 2º plano y "prefers-reduced-motion".
       Aquí solo limpiamos estilos inline que hayan quedado de versiones
       anteriores con GSAP, para que nada se atasque invisible. */
    function animateActiveSlideContent() {
      slider.querySelectorAll('.hero-banner-content > *').forEach(function (el) {
        if (el.style.opacity !== '' || el.style.transform !== '') {
          el.style.opacity = '';
          el.style.transform = '';
        }
      });
    }

    var wrapFallbackTimer = null;

    function moveToVirtualIndex(targetVIndex, animate, durationMs) {
      virtualIndex = targetVIndex;
      var w = getContainerWidth();
      var targetPx = -virtualIndex * w;
      updateActiveState();
      isAnimating = animate;
      setTrackPosition(targetPx, animate, durationMs);
      if (animate) {
        animateActiveSlideContent();
        // Red de seguridad: si el navegador no dispara transitionend
        // (pestaña en segundo plano, transición interrumpida) el
        // virtualIndex se iría acumulando hasta salirse del riel y
        // dejar el carrusel en negro. Este timer garantiza el wrap.
        if (wrapFallbackTimer) clearTimeout(wrapFallbackTimer);
        wrapFallbackTimer = setTimeout(checkBoundaryWrap, (durationMs || 400) + 120);
      }
    }

    function checkBoundaryWrap() {
      if (wrapFallbackTimer) {
        clearTimeout(wrapFallbackTimer);
        wrapFallbackTimer = null;
      }
      var w = getContainerWidth();
      // Normaliza SIEMPRE a la ventana [BUFFER, BUFFER + N - 1], sin
      // importar cuánto se haya desviado el índice (una sola resta no
      // alcanza si se perdieron varios transitionend seguidos).
      var normalized = BUFFER + getRealIndex(virtualIndex);
      if (normalized !== virtualIndex) {
        virtualIndex = normalized;
        setTrackPosition(-virtualIndex * w, false);
      }
      isAnimating = false;
      updateActiveState();
    }

    slider.addEventListener('transitionend', function (e) {
      if (e.target !== slider) return;
      checkBoundaryWrap();
    });

    // Auto-avance cada 5s
    function startAutoSlide() {
      stopAutoSlide();
      timer = setInterval(function () {
        if (!isDragging) {
          moveToVirtualIndex(virtualIndex + 1, true, 450);
        }
      }, 5000);
    }

    function stopAutoSlide() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    // Flechas anterior y siguiente con bucle infinito
    if (prevBtn) {
      prevBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        moveToVirtualIndex(virtualIndex - 1, true, 400);
        startAutoSlide();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        moveToVirtualIndex(virtualIndex + 1, true, 400);
        startAutoSlide();
      });
    }

    // Dots direct jump
    dots.forEach(function (dot, dotIdx) {
      dot.addEventListener('click', function (e) {
        e.stopPropagation();
        moveToVirtualIndex(BUFFER + dotIdx, true, 400);
        startAutoSlide();
      });
    });

    // --- Arrastre táctil y mouse con Pointer Events ---
    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      isDragging = true;
      draggedFar = false;
      isSwipingHorizontal = null;
      startX = e.clientX;
      startY = e.clientY;
      currentX = startX;
      currentY = startY;
      startTime = Date.now();

      stopAutoSlide();

      // Tomar control inmediato
      var w = getContainerWidth();
      var transformMatrix = window.getComputedStyle(slider).transform;
      if (transformMatrix && transformMatrix !== 'none') {
        var match = transformMatrix.match(/matrix.*\((.+)\)/);
        if (match) {
          var values = match[1].split(',');
          var currentPx = parseFloat(values[4]) || (-virtualIndex * w);
          setTrackPosition(currentPx, false);
          virtualIndex = Math.round(-currentPx / w);
        }
      } else {
        setTrackPosition(-virtualIndex * w, false);
      }

      slider.classList.add('is-dragging');
      if (typeof slider.setPointerCapture === 'function') {
        try { slider.setPointerCapture(e.pointerId); } catch (err) {}
      }
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      currentX = e.clientX;
      currentY = e.clientY;

      var diffX = currentX - startX;
      var diffY = currentY - startY;

      if (isSwipingHorizontal === null) {
        if (Math.abs(diffX) > 7 || Math.abs(diffY) > 7) {
          isSwipingHorizontal = Math.abs(diffX) >= Math.abs(diffY);
        }
      }

      if (isSwipingHorizontal === false) {
        return;
      }

      if (isSwipingHorizontal === true) {
        if (e.cancelable) e.preventDefault();
        if (Math.abs(diffX) > 8) {
          draggedFar = true;
        }
        var w = getContainerWidth();
        var currentPx = -virtualIndex * w + diffX;
        setTrackPosition(currentPx, false);
      }
    }

    function onPointerUp(e) {
      if (!isDragging) return;
      isDragging = false;
      slider.classList.remove('is-dragging');

      if (typeof slider.releasePointerCapture === 'function') {
        try { slider.releasePointerCapture(e.pointerId); } catch (err) {}
      }

      var diffX = currentX - startX;
      var elapsed = Date.now() - startTime;
      var velocity = Math.abs(diffX) / (elapsed || 1);
      var w = getContainerWidth();

      var advanceThreshold = w * 0.18;
      var targetVIndex = virtualIndex;

      if (isSwipingHorizontal === true) {
        if (diffX < -advanceThreshold || (diffX < -25 && velocity > 0.35)) {
          targetVIndex = virtualIndex + 1;
        } else if (diffX > advanceThreshold || (diffX > 25 && velocity > 0.35)) {
          targetVIndex = virtualIndex - 1;
        }
      }

      moveToVirtualIndex(targetVIndex, true, 380);
      startAutoSlide();

      setTimeout(function () {
        isSwipingHorizontal = null;
      }, 50);
    }

    slider.addEventListener('pointerdown', onPointerDown);
    slider.addEventListener('pointermove', onPointerMove, { passive: false });
    slider.addEventListener('pointerup', onPointerUp);
    slider.addEventListener('pointercancel', onPointerUp);

    // Evitar que un arrastre dispare clicks accidentales en los botones del banner
    outerContainer.addEventListener('click', function (e) {
      if (draggedFar) {
        e.preventDefault();
        e.stopPropagation();
        draggedFar = false;
      }
    }, true);

    // Pausar en hover (desktop)
    outerContainer.addEventListener('mouseenter', function () {
      stopAutoSlide();
    });
    outerContainer.addEventListener('mouseleave', function () {
      if (!isDragging) startAutoSlide();
    });

    // Delegación de clicks en CTA
    outerContainer.addEventListener('click', function (e) {
      var cta = e.target.closest('[data-target-cat]');
      if (!cta || draggedFar) return;
      var targetCat = cta.getAttribute('data-target-cat');
      if (typeof window.rodizioSelectCategory === 'function') {
        window.rodizioSelectCategory(targetCat);
      } else {
        var menuEl = document.getElementById('menu-content');
        if (menuEl) menuEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // Responsive resize
    window.addEventListener('resize', function () {
      var w = getContainerWidth();
      setTrackPosition(-virtualIndex * w, false);
    });

    // Inicializar en Slide 0
    moveToVirtualIndex(BUFFER, false);
    animateActiveSlideContent();
    startAutoSlide();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeroSlider);
  } else {
    initHeroSlider();
  }
})();
