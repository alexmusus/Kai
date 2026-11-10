/*
 * controllers/player/mini.js — El mini reproductor: el video sigue sonando mientras navegas por Kai; y volver
 * desde la ventana flotante del sistema.
 */

import { P } from './state.js';
import { stage, mini, video } from './dom.js';
import { $ } from '../../lib/util.js';
import { calmMotion, motionMs, motionEase } from '../../lib/motion.js';
import { episodeLabel } from '../../models/collections.js';
import { ICON } from '../../views/icons.js';
import { route } from '../../lib/route.js';
import { go } from '../router.js';
import { setKaiFullscreen, isFullscreen, exitFullscreen, setLights, closeMenu } from './controls.js';
['play', 'pause', 'timeupdate', 'loadedmetadata'].forEach((ev) => video.addEventListener(ev, paintMini));

video.addEventListener('leavepictureinpicture', backFromSystemPip);

/** Vuelve del mini al reproductor grande. */
export function openFromMini() {
  if (mini.hidden || !P.playing) return;
  go('#/play/' + encodeURIComponent(P.playing.ep.id));
}
/* En Android a veces había que tocar el mini dos veces: el primer toque no llegaba como clic. Con el dedo se abre al
 * soltarlo (si no se movió), sin esperar ese clic; el clic que llega después ya no hace nada (el mini se cerró). */
let downAt = /** @type {{ x: number, y: number, t: number } | null} */ (null);
mini.addEventListener('pointerdown', (e) => {
  downAt = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
});
mini.addEventListener('pointerup', (e) => {
  const d = downAt;
  downAt = null;
  if (!d || e.pointerType !== 'touch') return;
  if (!(/** @type {Element} */ (e.target).closest('[data-act="mini-open"]'))) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12 || Date.now() - d.t > 800) return;
  openFromMini();
  swallowUntil = Date.now() + 700;
});
mini.addEventListener('pointercancel', () => (downAt = null));
// el clic de ese mismo toque llega después a lo que quedó bajo el dedo (ya es la página del reproductor): se ignora
let swallowUntil = 0;
document.addEventListener(
  'click',
  (e) => {
    if (Date.now() > swallowUntil) return;
    swallowUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);

video.addEventListener('webkitpresentationmodechanged', () => {
  if (video.webkitPresentationMode === 'inline') backFromSystemPip();
});

export { calmMotion };

/**
 * Hace que `el` parezca salir de `from` y llegar a donde ya está (la técnica FLIP: se mueve primero y se anima
 * desde donde estaba). Solo transform y opacity: el teléfono lo anima sin volver a dibujar la página.
 * @param {HTMLElement} el lo que se anima
 * @param {DOMRect} from dónde se veía antes
 * @param {DOMRect} to dónde se ve ahora la parte de `el` que tiene que coincidir con `from`
 * @param {number} [opacity] con qué opacidad empieza
 * @param {number} [duration] ms (si no se dice, --kai-fly-dur)
 * @returns {Animation | null}
 */
export function flyFrom(el, from, to, opacity = 1, duration = motionMs('--kai-fly-dur', 320)) {
  if (calmMotion() || !duration || !from.width || !to.width || !el.animate) return null;
  const box = el.getBoundingClientRect();
  const s = from.width / to.width;
  return el.animate(
    [
      {
        transformOrigin: `${to.left - box.left}px ${to.top - box.top}px`,
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`,
        opacity,
      },
      { transformOrigin: `${to.left - box.left}px ${to.top - box.top}px`, transform: 'none', opacity: 1 },
    ],
    { duration, easing: motionEase('--kai-fly-ease', 'cubic-bezier(0.22, 1, 0.36, 1)') },
  );
}

/**
 * Pasa al mini reproductor. Con `from` (deslizar hacia abajo), el mini sale volando desde donde quedó el video bajo el
 * dedo, sin esperar a que el navegador termine de volver atrás (en iPhone eso tarda y el video se quedaba congelado).
 * @param {{ from?: DOMRect, opacity?: number }} [opts]
 * @returns {Animation | null} el vuelo, si lo hay
 */
export function enterMini({ from, opacity } = {}) {
  if (!P.playing) return null;
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
  stage.style.transformOrigin = '';
  stage.style.opacity = '';
  stage.classList.add('is-mini');
  stage.hidden = false;
  mini.hidden = false;
  document.documentElement.classList.add('has-mini');
  paintMini();
  if (from && wasHidden && !calmMotion()) {
    mini.style.animation = 'none'; // la entrada de siempre (CSS) no se suma al vuelo
    const fly = flyFrom(mini, from, /** @type {HTMLElement} */ ($('#mini-slot')).getBoundingClientRect(), opacity);
    if (fly) {
      mini.classList.add('is-flying');
      const land = () => mini.classList.remove('is-flying');
      fly.finished.then(land, land);
    }
    return fly;
  }
  return null;
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
