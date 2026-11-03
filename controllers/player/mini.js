/*
 * controllers/player/mini.js — El mini reproductor: el video sigue sonando mientras navegas por Kai; y volver
 * desde la ventana flotante del sistema.
 */

import { P } from './state.js';
import { stage, mini, video } from './dom.js';
import { $ } from '../../lib/util.js';
import { episodeLabel } from '../../models/collections.js';
import { ICON } from '../../views/icons.js';
import { route } from '../../lib/route.js';
import { go } from '../router.js';
import { setKaiFullscreen, isFullscreen, exitFullscreen, setLights, closeMenu } from './controls.js';
['play', 'pause', 'timeupdate', 'loadedmetadata'].forEach((ev) => video.addEventListener(ev, paintMini));

video.addEventListener('leavepictureinpicture', backFromSystemPip);

video.addEventListener('webkitpresentationmodechanged', () => {
  if (video.webkitPresentationMode === 'inline') backFromSystemPip();
});

/** ¿Sin animaciones? (modo liviano o "reducir movimiento" del sistema) */
export const calmMotion = () =>
  document.documentElement.classList.contains('lite') || matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Hace que `el` parezca salir de `from` y llegar a donde ya está (la técnica FLIP: se mueve primero y se anima
 * desde donde estaba). Solo transform y opacity: el teléfono lo anima sin volver a dibujar la página.
 * @param {HTMLElement} el lo que se anima
 * @param {DOMRect} from dónde se veía antes
 * @param {DOMRect} to dónde se ve ahora la parte de `el` que tiene que coincidir con `from`
 * @param {number} [opacity] con qué opacidad empieza
 */
export function flyFrom(el, from, to, opacity = 1) {
  if (calmMotion() || !from.width || !to.width || !el.animate) return;
  const box = el.getBoundingClientRect();
  const s = from.width / to.width;
  el.animate(
    [
      {
        transformOrigin: `${to.left - box.left}px ${to.top - box.top}px`,
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`,
        opacity,
      },
      { transformOrigin: `${to.left - box.left}px ${to.top - box.top}px`, transform: 'none', opacity: 1 },
    ],
    { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
}

/**
 * Pasa al mini reproductor. Con `from` (deslizar hacia abajo), el mini sale volando desde donde quedó el video bajo el
 * dedo, sin esperar a que el navegador termine de volver atrás (en iPhone eso tarda y el video se quedaba congelado).
 * @param {{ from?: DOMRect, opacity?: number }} [opts]
 */
export function enterMini({ from, opacity } = {}) {
  if (!P.playing) return;
  const wasHidden = mini.hidden;
  if (stage.classList.contains('kai-fs')) setKaiFullscreen(false);
  else if (isFullscreen()) exitFullscreen();
  if (document.body.classList.contains('lights-off')) setLights(false);
  closeMenu();
  const slot = $('#mini-slot');
  if (stage.parentElement !== slot) slot.prepend(stage);
  // lo que le dejó el gesto de deslizar hacia abajo
  stage.style.transition = '';
  stage.style.transform = '';
  stage.style.opacity = '';
  stage.classList.add('is-mini');
  stage.hidden = false;
  mini.hidden = false;
  document.documentElement.classList.add('has-mini');
  paintMini();
  if (from && wasHidden && !calmMotion()) {
    mini.style.animation = 'none'; // la entrada de siempre (CSS) no se suma al vuelo
    flyFrom(mini, from, /** @type {HTMLElement} */ ($('#mini-slot')).getBoundingClientRect(), opacity);
  }
}
export function leaveMini() {
  stage.classList.remove('is-mini');
  if (mini.hidden) return;
  mini.hidden = true;
  mini.style.animation = '';
  document.documentElement.classList.remove('has-mini');
}
/** @param {HTMLElement} el @param {string} v */
function setText(el, v) {
  if (el.textContent !== v) el.textContent = v;
}

export function paintMini() {
  if (mini.hidden || !P.playing) return;
  // se llama en cada 'timeupdate' (varias veces por segundo): solo se toca lo que cambió
  setText($('#mini-title'), episodeLabel(P.playing.ep));
  setText($('#mini-sub'), P.playing.ctx.title || '');
  const t = $('#mini-toggle');
  const paused = video.paused;
  if (t.dataset.paused !== String(paused)) {
    t.dataset.paused = String(paused);
    t.innerHTML = paused ? ICON.play : ICON.pause;
    t.setAttribute('aria-label', paused ? 'Reproducir' : 'Pausar');
  }
  const d = isFinite(video.duration) ? video.duration : 0;
  mini.style.setProperty('--mp', d ? (video.currentTime / d) * 100 + '%' : '0%');
}

// al volver de la ventana flotante del sistema con el botón "volver a la pestaña", regresa al reproductor grande
export function backFromSystemPip() {
  setTimeout(() => {
    if (P.playing && !video.paused && route().view !== 'play') go('#/play/' + encodeURIComponent(P.playing.ep.id));
  }, 60);
}
