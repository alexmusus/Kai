/*
 * controllers/player/gestures.js — Gestos en el teléfono: doble toque a los lados para ±10 s, mantener presionado
 * para 2×, deslizar arriba para pantalla completa y abajo para salir o pasar al mini reproductor.
 */

import { stage, video, holdEl, ui } from './dom.js';
import { P } from './state.js';
import { goBack } from '../router.js';
import { LS } from '../../lib/util.js';
import { isFullscreen, togglePlay, wake, toggleFullscreen, seekBy, exitFullscreen } from './controls.js';
LS.del('bright'); // la barra de brillo se quitó en v16

ui.tap.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || !e.isPrimary) return;
  try {
    ui.tap.setPointerCapture(e.pointerId);
  } catch {
    /* nada */
  }
  // la posición del video se mide una vez al tocar: medirla en cada movimiento, justo después de moverlo, obligaba
  // al navegador a recalcular la página en cada cuadro (en teléfonos de gama media se sentía trabado)
  const rect = stage.getBoundingClientRect();
  const p = videoPoint(e, rect);
  if (Date.now() - P.lastTap < DOUBLE_TAP) clearTimeout(P.tapTimer); // puede ser el segundo toque: no ocultar controles todavía
  P.touch = { id: e.pointerId, x: p.x, y: p.y, w: p.w, h: p.h, mode: null, hold: false, at: Date.now(), rect };
  const t = P.touch;
  t.timer = setTimeout(() => {
    if (P.touch !== t || t.mode || !video.currentSrc || video.paused || video.ended) return;
    t.hold = true;
    t.mode = 'hold';
    video.playbackRate = 2;
    holdEl.classList.add('is-on');
    clearTimeout(P.tapTimer);
  }, 500);
});

ui.tap.addEventListener('pointermove', (e) => {
  const t = P.touch;
  if (!t || e.pointerId !== t.id) return;
  const p = videoPoint(e, t.rect);
  const dx = p.x - t.x;
  const dy = t.y - p.y; // hacia arriba del video es positivo
  if (!t.mode && Math.hypot(dx, dy) > 12) {
    clearTimeout(t.timer);
    const vertical = Math.abs(dy) > Math.abs(dx);
    // en pantalla completa, abajo = salir; en la página, abajo = mini reproductor y arriba = pantalla completa
    t.mode = !vertical ? 'none' : isFullscreen() ? (dy < 0 ? 'fs-down' : 'none') : dy < 0 ? 'down' : 'up';
  }
  if (t.mode === 'down' || t.mode === 'fs-down') {
    const d = Math.max(0, p.y - t.y);
    t.dist = d;
    // el video sigue al dedo; girado, "abajo" del video es hacia la izquierda de la pantalla
    // se dibuja una vez por cuadro aunque el dedo mande más movimientos (Android manda hasta 120 por segundo)
    if (!t.frame)
      t.frame = requestAnimationFrame(() => {
        t.frame = 0;
        if (P.touch !== t) return;
        const k = Math.min(t.dist || 0, 220);
        const base = isRotated() ? 'rotate(90deg) ' : '';
        stage.style.transition = 'none';
        stage.style.transform = `${base}translateY(${k * 0.6}px) scale(${1 - k / 1100})`;
        stage.style.opacity = String(1 - k / 600);
      });
  } else if (t.mode === 'up') {
    t.dist = Math.max(0, t.y - p.y);
  }
});

ui.tap.addEventListener('pointerup', (e) => touchEnd(e, false));

ui.tap.addEventListener('pointercancel', (e) => touchEnd(e, true));

ui.tap.addEventListener('contextmenu', (e) => e.preventDefault()); // mantener presionado no abre el menú del sistema

ui.tap.addEventListener('click', (e) => {
  if (Date.now() - P.lastTouchEnd < 800) return; // ya lo manejaron los gestos táctiles
  if (e.pointerType === 'mouse' || (!e.pointerType && matchMedia('(hover: hover)').matches)) {
    clearTimeout(P.tapTimer);
    P.tapTimer = setTimeout(() => {
      togglePlay();
    }, 200);
    wake();
    return;
  }
  const p = videoPoint(e);
  handleTouchTap(p.x / Math.max(1, p.w));
});

ui.tap.addEventListener('dblclick', (e) => {
  if (!matchMedia('(hover: hover)').matches) return;
  clearTimeout(P.tapTimer);
  e.preventDefault();
  toggleFullscreen();
});

stage.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') wake();
});

/** ¿El reproductor está girado 90° con CSS (iPhone vertical en pantalla completa)? */
export const isRotated = () =>
  stage.classList.contains('kai-rot') &&
  stage.classList.contains('kai-fs') &&
  matchMedia('(orientation: portrait)').matches;
/** Punto del toque en coordenadas del video (x hacia la derecha, y hacia abajo del video), aunque esté girado. */
export function videoPoint(e, rect) {
  if (isRotated()) return { x: e.clientY, y: innerWidth - e.clientX, w: innerHeight, h: innerWidth };
  const r = rect || stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}

export function tapSide(fx) {
  return fx < 0.4 ? 'left' : fx > 0.6 ? 'right' : 'center';
}
// como en Android e iOS: el doble toque se mide desde que se soltó el primero hasta que empieza el segundo
export const DOUBLE_TAP = 300;
export function handleTouchTap(fx, downAt = Date.now()) {
  const side = tapSide(fx);
  const now = Date.now();
  const gap = downAt - P.lastTap;
  // racha de toques: tras un doble toque, cada toque rápido del mismo lado suma otros 10 s
  if (P.lastTapSide === side + '-streak' && gap < 650 && side !== 'center') {
    P.lastTap = now;
    seekBy(side === 'left' ? -10 : 10);
    return;
  }
  if (gap < DOUBLE_TAP && P.lastTapSide === side) {
    clearTimeout(P.tapTimer);
    P.lastTap = now;
    if (side === 'center') {
      P.lastTapSide = '';
      togglePlay();
      return;
    }
    P.lastTapSide = side + '-streak';
    seekBy(side === 'left' ? -10 : 10);
    return;
  }
  P.lastTap = now;
  P.lastTapSide = side;
  clearTimeout(P.tapTimer);
  P.tapTimer = setTimeout(() => {
    if (stage.classList.contains('is-idle') || video.paused) wake();
    else stage.classList.add('is-idle');
  }, DOUBLE_TAP + 60);
}

export function endHold() {
  if (!P.touch || !P.touch.hold) return;
  P.touch.hold = false;
  video.playbackRate = P.speed;
  holdEl.classList.remove('is-on');
}
const SWIPE_DOWN = 110;
export function touchEnd(e, cancelled) {
  const t = P.touch;
  if (!t || e.pointerId !== t.id) return;
  clearTimeout(t.timer);
  cancelAnimationFrame(t.frame || 0);
  P.lastTouchEnd = Date.now();
  if (t.hold) endHold();
  else if (t.mode === 'down' || t.mode === 'fs-down') {
    /* cuánto hay que bajar el dedo: antes la distancia se medía contra el video que ya iba bajando y había que
     * arrastrar unos 170 px para que pasara; ahora es lo que de verdad se movió el dedo */
    const far = !cancelled && (t.dist || 0) > SWIPE_DOWN;
    const toMini = far && t.mode === 'down' && !!P.playing;
    if (toMini) {
      // pasa al mini reproductor desde donde lo dejó el dedo: sin regresar antes a su lugar (las dos animaciones a la
      // vez se veían trabadas). Al llegar al mini se le quita lo que le puso el dedo (enterMini).
      if (P.playing) goBack(P.playing.ctx.back);
    } else {
      stage.style.transition = 'transform 0.2s, opacity 0.2s';
      stage.style.transform = '';
      stage.style.opacity = '';
      setTimeout(() => {
        stage.style.transition = '';
      }, 220);
      if (far) exitFullscreen(); // vuelve al reproductor normal
    }
  } else if (t.mode === 'up') {
    if (!cancelled && t.dist > 60) toggleFullscreen();
  } else if (!t.mode && !cancelled) handleTouchTap(t.x / Math.max(1, t.w), t.at);
  P.touch = null;
}
